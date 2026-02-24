import OpenAI from "openai";
import { LLM_CONFIG } from "@/lib/config";
import type { AuditLogger } from "@/lib/audit";

export type TriageLabelOption = {
  labelId: string;
  displayName: string;
  description?: string | null;
  playbookTitle: string;
  productTypes?: string[];
};

export type TriageHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type PlaybookTriageInput = {
  labels: TriageLabelOption[];
  triageHistory: TriageHistoryItem[];
  imageBuffers?: Buffer[];
  currentProductType?: string | null;
};

export type PlaybookTriageResult = {
  selectedLabelId: string | null;
  confidence: number;
  reasoning: string;
  followUpQuestion: string | null;
  candidateLabels: string[];
};

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export async function runPlaybookTriage(
  input: PlaybookTriageInput,
  audit?: AuditLogger
): Promise<PlaybookTriageResult> {
  if (input.labels.length === 0) {
    return {
      selectedLabelId: null,
      confidence: 0,
      reasoning: "No labels are configured.",
      followUpQuestion: "I couldn't find any diagnostic categories configured yet. Please contact support.",
      candidateLabels: [],
    };
  }

  const labelBlock = input.labels
    .map((l) => {
      const productTypeSummary =
        l.productTypes && l.productTypes.length > 0
          ? l.productTypes.join(", ")
          : "all product types";
      return `- ${l.labelId}: ${l.displayName}${l.description ? ` (${l.description})` : ""}; playbook="${l.playbookTitle}"; applies_to="${productTypeSummary}"`;
    })
    .join("\n");

  const historyBlock = input.triageHistory
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const systemPrompt = `You triage support requests into exactly one label when possible.
Available labels:
${labelBlock}

Use BOTH text and any submitted images.
If confidence is low, ask a focused follow-up question that helps disambiguate labels.

Respond in JSON only:
{
  "selected_label_id": "string | null",
  "confidence": "number 0..1",
  "reasoning": "short internal rationale",
  "follow_up_question": "string | null",
  "candidate_labels": ["label_id_1", "label_id_2", "label_id_3"]
}

Rules:
- candidate_labels must contain valid label IDs only.
- Include 2-3 candidate labels when uncertain.
- If confidence >= 0.8 and a label is clear, set selected_label_id.
- If uncertain, selected_label_id may be null and follow_up_question should be non-empty.
- If product type is known, prefer labels tied to that product type; labels with applies_to="all product types" are valid for any product type.
- Never invent labels not listed above.`;

  const userPrompt = `Conversation for triage:
${historyBlock || "(empty)"}
${input.currentProductType ? `\nKnown product type: ${input.currentProductType}` : ""}

Return JSON only.`;

  const hasImages = (input.imageBuffers?.length ?? 0) > 0;
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = hasImages
    ? [
        ...(input.imageBuffers ?? []).map((buf) => ({
          type: "image_url" as const,
          image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
        })),
        { type: "text" as const, text: userPrompt },
      ]
    : [{ type: "text" as const, text: userPrompt }];

  const llmStart = Date.now();
  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.classificationModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  const text = res.choices[0]?.message?.content;
  if (!text) {
    return {
      selectedLabelId: null,
      confidence: 0,
      reasoning: "Empty triage model response.",
      followUpQuestion: "Could you share one or two more details about the issue symptoms?",
      candidateLabels: [],
    };
  }

  let parsed: {
    selected_label_id?: string | null;
    confidence?: number;
    reasoning?: string;
    follow_up_question?: string | null;
    candidate_labels?: string[];
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  const validLabelIds = new Set(input.labels.map((l) => l.labelId));
  const selectedLabelId = parsed.selected_label_id && validLabelIds.has(parsed.selected_label_id)
    ? parsed.selected_label_id
    : null;
  const candidateLabels = (parsed.candidate_labels ?? []).filter((id) => validLabelIds.has(id)).slice(0, 3);
  const result: PlaybookTriageResult = {
    selectedLabelId,
    confidence: clamp01(Number(parsed.confidence ?? 0)),
    reasoning: parsed.reasoning?.trim() || "No rationale provided.",
    followUpQuestion: parsed.follow_up_question?.trim() || null,
    candidateLabels,
  };

  audit?.logLlmCall({
    name: "playbook_triage",
    model: LLM_CONFIG.classificationModel,
    systemPrompt,
    userPrompt,
    imageCount: input.imageBuffers?.length ?? 0,
    rawResponse: text,
    parsedResponse: result,
    tokensUsed: res.usage,
    durationMs: Date.now() - llmStart,
  });

  return result;
}
