import OpenAI from "openai";
import { LLM_CONFIG, DIAGNOSTIC_CONFIG } from "@/lib/config";
import { validateGrounding, enforcePlaybookInstructions, type PlaybookStep, type LLMStep } from "./validate-grounding";

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

// --- Types for diagnostic playbook (JSONB shapes) ---
export type SymptomItem = { id: string; description: string };
export type EvidenceChecklistItem = {
  id: string;
  description: string;
  actionId?: string;
  type: "photo" | "reading" | "observation" | "action" | "confirmation";
  required: boolean;
};
export type CandidateCause = {
  id: string;
  cause: string;
  likelihood: "high" | "medium" | "low";
  rulingEvidence: string[];
};
export type DiagnosticQuestionItem = {
  id: string;
  question: string;
  purpose: string;
  whenToAsk?: string;
  actionId?: string;
};
export type EscalationTriggerItem = { trigger: string; reason: string };

export type DiagnosticPlaybook = {
  id: string;
  labelId: string;
  title: string;
  steps: PlaybookStep[];
  symptoms?: SymptomItem[] | null;
  evidenceChecklist?: EvidenceChecklistItem[] | null;
  candidateCauses?: CandidateCause[] | null;
  diagnosticQuestions?: DiagnosticQuestionItem[] | null;
  escalationTriggers?: EscalationTriggerItem[] | null;
};

export type EvidenceRecord = {
  value: unknown;
  type: string;
  unit?: string;
  confidence: "exact" | "approximate" | "uncertain";
  collectedAt: string;
  turn: number;
};

export type HypothesisState = {
  causeId: string;
  confidence: number;
  reasoning: string;
  status: "active" | "ruled_out" | "confirmed";
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  timestamp?: string;
};

export type PlannerRequest = {
  type: "question" | "photo" | "action" | "reading";
  id: string;
  prompt: string;
  expectedInput?: {
    type: string;
    unit?: string;
    range?: { min: number; max: number };
    options?: string[];
    values?: string[];
    enum?: string[];
  };
};

export type PlannerOutput = {
  message: string;
  phase: "gathering_info" | "diagnosing" | "resolving" | "resolved_followup" | "escalated";
  requests: PlannerRequest[];
  hypotheses_update: {
    causeId: string;
    confidence: number;
    reasoning: string;
    status: "active" | "ruled_out" | "confirmed";
  }[];
  evidence_extracted: {
    evidenceId: string;
    value: unknown;
    confidence: "exact" | "approximate" | "uncertain";
  }[];
  resolution?: {
    causeId: string;
    diagnosis: string;
    steps: { step_id: string; instruction: string; check?: string }[];
    why: string;
  };
  escalation_reason?: string;
  /** When evidence contradicts current playbook, suggest switching to a different label */
  suggested_label_switch?: string;
};

export type ActionRecord = {
  id: string;
  title: string;
  instructions: string;
  expectedInput: unknown;
  safetyLevel: string;
};

export type DiagnosticPlannerInput = {
  playbook: DiagnosticPlaybook;
  evidence: Record<string, EvidenceRecord>;
  hypotheses: HypothesisState[];
  phase: string;
  turnCount: number;
  recentMessages: ChatMessage[];
  docChunks: { id: string; content: string; metadata?: unknown }[];
  actions: ActionRecord[];
  lastUserMessage: string;
  machineModel?: string | null;
  /** Image buffers from the current turn to send as vision content */
  imageBuffers?: Buffer[];
  /** Outstanding request IDs from previous turn (so LLM can map user reply to evidence) */
  outstandingRequestIds?: string[];
};

function buildStateSummary(input: DiagnosticPlannerInput): string {
  const lines: string[] = [];
  lines.push("## Evidence collected so far");
  const evidence = input.evidence;
  if (Object.keys(evidence).length === 0) {
    lines.push("(none yet)");
  } else {
    for (const [eid, rec] of Object.entries(evidence)) {
      lines.push(`- ${eid}: ${JSON.stringify(rec.value)} (${rec.confidence})`);
    }
  }
  lines.push("\n## Current hypotheses");
  for (const h of input.hypotheses) {
    lines.push(`- ${h.causeId}: confidence ${(h.confidence * 100).toFixed(0)}%, status ${h.status}, reasoning: ${h.reasoning}`);
  }
  lines.push(`\nPhase: ${input.phase}, Turn: ${input.turnCount}`);
  const checklist = input.playbook.evidenceChecklist ?? [];
  const missing = checklist.filter((e) => !(e.id in evidence)).map((e) => e.id);
  if (missing.length) {
    lines.push(`Missing evidence IDs: ${missing.join(", ")}`);
  }
  return lines.join("\n");
}

function buildPlaybookBlock(playbook: DiagnosticPlaybook): string {
  const lines: string[] = ["## Diagnostic playbook", `Title: ${playbook.title}`, `Label: ${playbook.labelId}`];
  const symptoms = playbook.symptoms ?? [];
  if (symptoms.length) {
    lines.push("\n### Symptoms");
    symptoms.forEach((s) => lines.push(`- ${s.id}: ${s.description}`));
  }
  const checklist = playbook.evidenceChecklist ?? [];
  if (checklist.length) {
    lines.push("\n### Evidence checklist");
    checklist.forEach((e) =>
      lines.push(`- ${e.id}: ${e.description}, type=${e.type}, required=${e.required}${e.actionId ? `, actionId=${e.actionId}` : ""}`)
    );
  }
  const causes = playbook.candidateCauses ?? [];
  if (causes.length) {
    lines.push("\n### Candidate causes");
    causes.forEach((c) => lines.push(`- ${c.id}: ${c.cause}, likelihood=${c.likelihood}, rulingEvidence=[${c.rulingEvidence.join(", ")}]`));
  }
  const triggers = playbook.escalationTriggers ?? [];
  if (triggers.length) {
    lines.push("\n### Escalation triggers (if user mentions these, escalate)");
    triggers.forEach((t) => lines.push(`- "${t.trigger}": ${t.reason}`));
  }
  lines.push("\n### Resolution steps (use these step_ids when phase is resolving)");
  const steps = playbook.steps ?? [];
  steps.forEach((s) => lines.push(`- step_id: ${s.step_id}, title: ${s.title ?? ""}, instruction: ${s.instruction ?? ""}`));
  return lines.join("\n");
}

function buildActionsBlock(actions: ActionRecord[]): string {
  if (actions.length === 0) return "";
  const lines = ["## Allowed actions (reference by id in requests)"];
  actions.forEach((a) => {
    lines.push(`- id: ${a.id}, title: ${a.title}, safetyLevel: ${a.safetyLevel}`);
    lines.push(`  instructions: ${a.instructions}`);
    if (a.expectedInput) lines.push(`  expectedInput: ${JSON.stringify(a.expectedInput)}`);
  });
  return lines.join("\n");
}

const OUTPUT_SCHEMA = `
You must respond with valid JSON only, no other text. Schema:
{
  "message": "string (short, user-facing reply: acknowledge their answer and say what happens next. Never use internal/meta phrases like 'we update the possible causes' or 'based on current evidence we revise'. If you have requests below, briefly introduce them (e.g. 'Next, please…'). If resolving, summarize the finding.)",
  "phase": "gathering_info" | "diagnosing" | "resolving" | "escalated",
  "requests": [
    {
      "type": "question" | "photo" | "action" | "reading",
      "id": "string (actionId or evidenceId from checklist)",
      "prompt": "string (what to ask or show the user)",
      "expectedInput": { "type": "string", "unit?: "string", "range?: { min: number, max: number }, options?: string[] } (optional, for reading type)
    }
  ],
  "hypotheses_update": [
    { "causeId": "string", "confidence": number 0-1, "reasoning": "string", "status": "active" | "ruled_out" | "confirmed" }
  ],
  "evidence_extracted": [
    { "evidenceId": "string (from checklist)", "value": any, "confidence": "exact" | "approximate" | "uncertain" }
  ],
  "resolution": { "causeId": "string", "diagnosis": "string", "steps": [{"step_id": "string", "instruction": "string", "check": "string?"}], "why": "string" } (only when phase is resolving),
  "escalation_reason": "string (only when phase is escalated)",
  "suggested_label_switch": "string (optional: if the user's symptoms clearly indicate a DIFFERENT issue category than this playbook covers, set this to the label_id that would be more appropriate. Only use this when evidence strongly contradicts the current playbook's scope.)"
}
Rules: Max 3 items in requests. When phase is "resolving", resolution.steps must only use step_ids from the playbook. When phase is "escalated", set escalation_reason. Extract evidence from the user's last message into evidence_extracted when they answered a request. When you are still gathering info or diagnosing and there are more evidence items or checks from the playbook to do, always include at least one request and make the message lead into it (e.g. "Thanks for checking. Next, please…"). Do not end the turn with only a meta-comment about updating hypotheses.

Critical: When you have gathered enough evidence (e.g. most of the evidence checklist is filled) and are ready to conclude, you MUST output either (a) phase "resolving" with a full "resolution" object (causeId, diagnosis, steps, why), or (b) phase "escalated" with escalation_reason. Never respond with phase "diagnosing" and empty "requests" and a message like "let's evaluate" or "we will evaluate causes"—deliver the actual conclusion (resolution or escalation) in this same response.`;

export async function runDiagnosticPlanner(input: DiagnosticPlannerInput): Promise<PlannerOutput> {
  const stateSummary = buildStateSummary(input);
  const playbookBlock = buildPlaybookBlock(input.playbook);
  const actionsBlock = buildActionsBlock(input.actions);
  const recentConv = input.recentMessages
    .slice(-DIAGNOSTIC_CONFIG.recentMessagesWindow)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const chunksText = input.docChunks
    .map((c) => `[${c.id}]\n${c.content.slice(0, 500)}`)
    .join("\n\n");

  const systemPrompt = `You are a diagnostic support assistant. You help users troubleshoot issues by gathering evidence and narrowing down root causes. Use the diagnostic playbook to know what evidence to collect and what causes to consider. Output structured JSON every turn.

Keep the "message" field strictly user-facing: the user should always know what you understood and what you want them to do next (or what the resolution is). Do not write internal reasoning (e.g. "we update the possible causes") in the message.

When your message references a fact from the document chunks, cite the source by its ID using the format (document <id>). For example: "The maximum output is 200 serves per hour (document 5e68ed0e-e094-421d-8291-b1d5afb3c631)." Always cite when stating specific numbers, procedures, or specifications from the documentation.

When enough evidence has been collected to narrow down causes, you must conclude in this turn: output phase "resolving" with a resolution (diagnosis + steps), or phase "escalated" if you cannot determine the cause. Do not leave the user with a message like "let's evaluate" and no resolution—provide the diagnosis or escalate in this same response.

${OUTPUT_SCHEMA}`;

  const userPrompt = `${playbookBlock}

${actionsBlock}

---

${stateSummary}

---

## Recent conversation (last ${DIAGNOSTIC_CONFIG.recentMessagesWindow} messages)
${recentConv}

## Document chunks (for context and citations)
${chunksText}

---

## User's latest message (parse evidence from this if they are answering a question)
${input.lastUserMessage}
${input.machineModel ? `\nMachine model: ${input.machineModel}` : ""}

${input.outstandingRequestIds?.length ? `Outstanding request IDs from your previous turn: ${input.outstandingRequestIds.join(", ")}. Map the user's reply to evidence_extracted using these IDs.` : ""}

Respond with JSON only.`;

  const hasImages = input.imageBuffers && input.imageBuffers.length > 0;
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = hasImages
    ? [
        ...input.imageBuffers!.map((buf) => ({
          type: "image_url" as const,
          image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
        })),
        { type: "text" as const, text: userPrompt },
      ]
    : [{ type: "text" as const, text: userPrompt }];

  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.diagnosticPlannerModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("Empty diagnostic planner response");
  const parsed = JSON.parse(text) as PlannerOutput;
  if (!parsed.message || !parsed.phase || !Array.isArray(parsed.requests)) {
    parsed.message = parsed.message ?? "I need a bit more information to help.";
    parsed.phase = parsed.phase ?? "gathering_info";
    parsed.requests = Array.isArray(parsed.requests) ? parsed.requests : [];
  }
  if (!Array.isArray(parsed.hypotheses_update)) parsed.hypotheses_update = [];
  if (!Array.isArray(parsed.evidence_extracted)) parsed.evidence_extracted = [];
  return parsed;
}

/** Answer a follow-up question after a diagnosis has been provided. Uses doc chunks and resolution context; returns plain text only. */
export async function runFollowUpAnswer(input: {
  recentMessages: ChatMessage[];
  docChunks: { id: string; content: string; metadata?: unknown }[];
  lastUserMessage: string;
  resolution: PlannerOutput["resolution"];
  machineModel?: string | null;
}): Promise<string> {
  const systemPrompt = `You are a helpful support assistant. A diagnosis has already been provided to the user. Answer the user's follow-up question using the provided documentation. Be direct and specific. Do not repeat the full diagnosis or resolution steps unless the user explicitly asks for them.

When your answer references a fact from the documentation, cite the source by its ID using the format (document <id>). For example: "The serving size is 80 grams (document 5e68ed0e-e094-421d-8291-b1d5afb3c631)." Always cite when stating specific numbers, procedures, or specifications.`;

  const resolutionBlock =
    input.resolution &&
    `## Resolution already provided to the user
Diagnosis: ${input.resolution.diagnosis}
Steps: ${(input.resolution.steps ?? []).map((s) => s.instruction).join("; ")}
Why: ${input.resolution.why}
`;

  const recentConv = input.recentMessages
    .slice(-DIAGNOSTIC_CONFIG.recentMessagesWindow)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const chunksText = input.docChunks
    .map((c) => `[${c.id}]\n${c.content.slice(0, 500)}`)
    .join("\n\n");

  const userPrompt = `${resolutionBlock ?? ""}
## Recent conversation (last ${DIAGNOSTIC_CONFIG.recentMessagesWindow} messages)
${recentConv}

## Documentation (use this to answer the question)
${chunksText}

---
${input.machineModel ? `Machine model: ${input.machineModel}\n\n` : ""}## User's follow-up question
${input.lastUserMessage}

Answer the user's question in one or two short paragraphs. Use only the documentation above when citing facts. Cite each source you use with (document <id>).`;

  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.diagnosticPlannerModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  return text ?? "I don't have specific information on that in the documentation. If you need more detail, please contact support.";
}

/** Validate planner output and sanitize for end user (strip technician_only actions, cap requests). */
export function validateAndSanitizePlannerOutput(
  output: PlannerOutput,
  playbook: DiagnosticPlaybook,
  actionsById: Map<string, ActionRecord>,
  forEndUser: boolean
): { output: PlannerOutput; errors: string[] } {
  const errors: string[] = [];
  const sanitized = { ...output, requests: [...output.requests] };

  const maxRequestsForChat = 1;
  const allowedMax = Math.min(
    DIAGNOSTIC_CONFIG.maxRequestsPerTurn,
    maxRequestsForChat
  );
  if (sanitized.requests.length > allowedMax) {
    sanitized.requests = sanitized.requests.slice(0, allowedMax);
    errors.push("Truncated requests to one-at-a-time chat flow");
  }

  const allowedIds = new Set(playbook.evidenceChecklist?.map((e) => e.id) ?? []);
  playbook.evidenceChecklist?.forEach((e) => e.actionId && allowedIds.add(e.actionId));

  const filtered: PlannerRequest[] = [];
  for (const req of sanitized.requests) {
    const nextReq: PlannerRequest = {
      ...req,
      expectedInput: req.expectedInput ? { ...req.expectedInput } : undefined,
    };
    const action = actionsById.get(req.id);
    const isEvidenceId = playbook.evidenceChecklist?.some((e) => e.id === req.id);
    const checklistItem = playbook.evidenceChecklist?.find(
      (e) => e.id === req.id || e.actionId === req.id
    );

    if (!nextReq.expectedInput && action?.expectedInput && typeof action.expectedInput === "object") {
      nextReq.expectedInput = action.expectedInput as PlannerRequest["expectedInput"];
    }

    const expectedType = nextReq.expectedInput?.type?.toLowerCase();
    const expectedOptions =
      nextReq.expectedInput?.options?.length
        ? nextReq.expectedInput.options
        : nextReq.expectedInput?.values?.length
          ? nextReq.expectedInput.values
          : nextReq.expectedInput?.enum?.length
            ? nextReq.expectedInput.enum
            : undefined;
    if (expectedType === "number") nextReq.type = "reading";
    else if (expectedType === "photo") nextReq.type = "photo";
    else if (expectedType === "boolean" || expectedType === "bool") {
      nextReq.type = "question";
      nextReq.expectedInput = {
        ...nextReq.expectedInput,
        type: "boolean",
        options: expectedOptions?.length ? expectedOptions : ["Yes", "No"],
      };
    } else if (expectedType === "enum" || (!!expectedOptions?.length && expectedType !== "text")) {
      nextReq.type = "question";
      nextReq.expectedInput = {
        ...nextReq.expectedInput,
        type: "enum",
        ...(expectedOptions?.length ? { options: expectedOptions } : {}),
      };
    } else if (expectedType === "text") {
      nextReq.type = "question";
    }

    if (
      checklistItem?.type === "confirmation" &&
      (!nextReq.expectedInput || expectedType === "text")
    ) {
      nextReq.type = "question";
      nextReq.expectedInput = { type: "boolean", options: ["Yes", "No"] };
    }

    if (!nextReq.prompt?.trim() && action?.instructions) {
      nextReq.prompt = action.instructions;
    }

    if (action) {
      if (forEndUser && action.safetyLevel === "technician_only") {
        errors.push(`Action ${req.id} is technician_only; skipped for end user`);
        continue;
      }
      if (forEndUser && action.safetyLevel === "caution") {
        nextReq.prompt = `⚠️ Caution: ${nextReq.prompt}`;
      }
    } else if (!isEvidenceId && !allowedIds.has(req.id)) {
      errors.push(`Request id ${req.id} is not in playbook evidence checklist or actions`);
      continue;
    }
    filtered.push(nextReq);
  }
  sanitized.requests = filtered;

  if (output.phase === "resolving" && output.resolution?.steps) {
    const playbookSteps = playbook.steps ?? [];
    const validation = validateGrounding(
      output.resolution.steps as LLMStep[],
      playbookSteps
    );
    if (validation.invalidStepIds.length > 0) {
      errors.push(`Invalid step_ids: ${validation.invalidStepIds.join(", ")}`);
      sanitized.phase = "diagnosing";
      sanitized.resolution = undefined;
    } else {
      if (validation.driftedStepIds.length > 0) {
        errors.push(`Instruction drift detected on: ${validation.driftedStepIds.join(", ")}; enforcing playbook text`);
      }
      sanitized.resolution = {
        ...sanitized.resolution!,
        steps: enforcePlaybookInstructions(
          sanitized.resolution!.steps as LLMStep[],
          playbookSteps
        ).map((s) => ({
          step_id: s.step_id,
          instruction: s.instruction ?? "",
          check: s.check,
        })),
      };
    }
  }

  return { output: sanitized, errors };
}

/** Check if user message contains any escalation trigger text (case-insensitive substring). */
export function checkEscalationTriggers(
  userMessage: string,
  triggers: EscalationTriggerItem[] | null | undefined
): { triggered: boolean; matched?: EscalationTriggerItem } {
  if (!triggers?.length) return { triggered: false };
  const lower = userMessage.toLowerCase();
  for (const t of triggers) {
    if (lower.includes(t.trigger.toLowerCase())) return { triggered: true, matched: t };
  }
  return { triggered: false };
}
