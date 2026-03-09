import "dotenv/config";
import OpenAI from "openai";
import { asc, eq } from "drizzle-orm";
import { db, actions, auditLogs, diagnosticSessions, playbooks } from "@/lib/db";
import type {
  ActionRecord,
  DiagnosticPlaybook,
  PlannerOutput,
} from "@/lib/pipeline/diagnostic-planner";
import { validateAndSanitizePlannerOutput } from "@/lib/pipeline/diagnostic-planner";
import { estimateOpenAIRequestTokens, withOpenAIRetry } from "@/lib/openai/retry";

const MODELS = ["gpt-4o", "gpt-5.4"] as const;
const MAX_COMPLETION_TOKENS = 900;

type CompareResult = {
  sessionId: string;
  model: string;
  durationMs: number;
  promptTokens: number;
  totalTokens: number;
  phase: string;
  resolutionCauseId: string | null;
  escalationReason: string | null;
  sanitizationErrors: string[];
  rawMessage: string;
};

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

async function loadReplayContext(sessionId: string): Promise<{
  playbook: DiagnosticPlaybook;
  actionsById: Map<string, ActionRecord>;
  evidence: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
}> {
  const [session] = await db
    .select()
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);
  if (!session?.playbookId) {
    throw new Error(`Session ${sessionId} does not have a playbook assigned`);
  }

  const [playbookRow] = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.id, session.playbookId))
    .limit(1);
  if (!playbookRow) {
    throw new Error(`Playbook ${session.playbookId} not found`);
  }
  const playbook = playbookRow as DiagnosticPlaybook;

  const auditRows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.sessionId, sessionId))
    .orderBy(asc(auditLogs.turnNumber), asc(auditLogs.createdAt));
  const latestPlannerCall = [...auditRows]
    .reverse()
    .flatMap((row) => {
      const payload = row.payload as Record<string, unknown>;
      return Array.isArray(payload.llmCalls) ? payload.llmCalls : [];
    })
    .find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).name === "diagnostic_planner"
    ) as Record<string, unknown> | undefined;

  if (!latestPlannerCall) {
    throw new Error(`No diagnostic_planner audit call found for session ${sessionId}`);
  }

  const playbookActionIds = new Set<string>();
  const evidenceChecklist = Array.isArray(playbook.evidenceChecklist)
    ? playbook.evidenceChecklist
    : [];
  for (const item of evidenceChecklist) {
    if (item.actionId) playbookActionIds.add(item.actionId);
  }
  const actionLookup = new Map(
    (
      playbookActionIds.size
        ? (await db.select().from(actions)).filter((row) => playbookActionIds.has(row.id))
        : []
    ).map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        instructions: row.instructions,
        expectedInput: row.expectedInput,
        safetyLevel: row.safetyLevel,
      } satisfies ActionRecord,
    ])
  );

  return {
    playbook,
    actionsById: actionLookup,
    evidence:
      session.evidence && typeof session.evidence === "object"
        ? (session.evidence as Record<string, unknown>)
        : {},
    systemPrompt: String(latestPlannerCall.systemPrompt ?? ""),
    userPrompt: String(latestPlannerCall.userPrompt ?? ""),
  };
}

async function replayForModel(
  sessionId: string,
  model: string,
  context: Awaited<ReturnType<typeof loadReplayContext>>
): Promise<CompareResult> {
  const openai = getOpenAI();
  const estimatedTokens = estimateOpenAIRequestTokens({
    texts: [context.systemPrompt, context.userPrompt],
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
  });
  const startedAt = Date.now();
  const response = await withOpenAIRetry(
    `replay_compare_${model}`,
    () =>
      openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: context.systemPrompt },
          { role: "user", content: context.userPrompt },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      }),
    { estimatedTokens }
  );

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<PlannerOutput>;
  const normalized: PlannerOutput = {
    message: parsed.message ?? "",
    phase:
      parsed.phase === "triaging" ||
      parsed.phase === "gathering_info" ||
      parsed.phase === "diagnosing" ||
      parsed.phase === "resolving" ||
      parsed.phase === "resolved_followup" ||
      parsed.phase === "escalated"
        ? parsed.phase
        : "gathering_info",
    requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    hypotheses_update: Array.isArray(parsed.hypotheses_update)
      ? parsed.hypotheses_update
      : [],
    evidence_extracted: Array.isArray(parsed.evidence_extracted)
      ? parsed.evidence_extracted
      : [],
    resolution: parsed.resolution,
    escalation_reason: parsed.escalation_reason,
    message_html: parsed.message_html,
    suggested_label_switch: parsed.suggested_label_switch,
  };
  const sanitized = validateAndSanitizePlannerOutput(
    normalized,
    context.playbook,
    context.actionsById,
    true,
    {
      maxRequestsPerTurn: 1,
    }
  );

  return {
    sessionId,
    model,
    durationMs: Date.now() - startedAt,
    promptTokens: Number(response.usage?.prompt_tokens ?? 0),
    totalTokens: Number(response.usage?.total_tokens ?? 0),
    phase: sanitized.output.phase,
    resolutionCauseId: sanitized.output.resolution?.causeId ?? null,
    escalationReason: sanitized.output.escalation_reason ?? null,
    sanitizationErrors: sanitized.errors,
    rawMessage: sanitized.output.message,
  };
}

async function main() {
  const sessionIds = process.argv.slice(2).filter(Boolean);
  if (sessionIds.length === 0) {
    throw new Error("Usage: node --import tsx scripts/replay-planner-model-compare.ts <session-id> [...]");
  }

  const results: CompareResult[] = [];
  for (const sessionId of sessionIds) {
    const context = await loadReplayContext(sessionId);
    for (const model of MODELS) {
      results.push(await replayForModel(sessionId, model, context));
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
