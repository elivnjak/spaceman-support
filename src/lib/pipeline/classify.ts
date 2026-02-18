import OpenAI from "openai";
import { LLM_CONFIG } from "@/lib/config";

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

export type ClassifyInput = {
  userText: string;
  imageMatchSummary: string;
  candidateLabels: { labelId: string; displayName: string }[];
  chunkTitles: string[];
  machineModel?: string;
};

export type ClassifyResult = {
  finalLabel: string;
  confidence: number;
  clarifyingQuestions?: string[];
};

export type ClassifyWithVisionInput = ClassifyInput & {
  imageBuffers: Buffer[];
};

const CLASSIFY_PROMPT_PREFIX = `You are a support assistant that classifies issues from user text and image similarity results.

User description: `;

const CLASSIFY_PROMPT_SUFFIX = `

Respond with JSON only, no other text:
{
  "final_label": "<label id from candidate labels, or 'unknown' if unclear>",
  "confidence": <0-1 number>,
  "clarifying_questions": ["optional question 1", "optional question 2"]
}

If the image matches are weak (e.g. top label score well below 0.5) or the user description clearly contradicts the top label, use final_label "unknown" and lower confidence. When one label clearly leads in the image similarity summary (e.g. score around 0.5 or above) and the user description is consistent with it, prefer that label. When you can see the user's photo(s) above, use them to choose among the candidate labels—pick the label that best matches what you see in the images.`;

function buildClassifyPrompt(input: ClassifyInput): string {
  const machineLine =
    input.machineModel != null && input.machineModel !== ""
      ? `\nMachine model: ${input.machineModel}\n`
      : "";
  return (
    CLASSIFY_PROMPT_PREFIX +
    input.userText +
    machineLine +
    `

Image similarity summary (top matches by label):
` +
    input.imageMatchSummary +
    `

Candidate labels (from image retrieval): ` +
    input.candidateLabels.map((l) => l.displayName).join(", ") +
    `

Retrieved document sections (titles): ` +
    input.chunkTitles.join("; ") +
    CLASSIFY_PROMPT_SUFFIX
  );
}

function parseClassifyResponse(text: string): ClassifyResult {
  const parsed = JSON.parse(text) as {
    final_label?: string;
    confidence?: number;
    clarifying_questions?: string[];
  };
  return {
    finalLabel: parsed.final_label ?? "unknown",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    clarifyingQuestions: parsed.clarifying_questions,
  };
}

export async function classifyLabel(input: ClassifyInput): Promise<ClassifyResult> {
  const prompt = buildClassifyPrompt(input);
  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.classificationModel,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("Empty classification response");
  return parseClassifyResponse(text);
}

export async function classifyLabelWithVision(
  input: ClassifyWithVisionInput
): Promise<ClassifyResult> {
  const machineLine =
    input.machineModel != null && input.machineModel !== ""
      ? `\nMachine model: ${input.machineModel}\n`
      : "";
  const textBlock =
    CLASSIFY_PROMPT_PREFIX +
    input.userText +
    machineLine +
    `

Image similarity summary (top matches by label):
` +
    input.imageMatchSummary +
    `

Candidate labels (from image retrieval): ` +
    input.candidateLabels.map((l) => l.displayName).join(", ") +
    `

Retrieved document sections (titles): ` +
    input.chunkTitles.join("; ") +
    `

Look at the user's photo(s) above and pick the label that best matches what you see.` +
    CLASSIFY_PROMPT_SUFFIX;

  const imageParts = input.imageBuffers.map((buf) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
  }));
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    ...imageParts,
    { type: "text" as const, text: textBlock },
  ];

  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.classificationModel,
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("Empty classification response");
  return parseClassifyResponse(text);
}
