import OpenAI from "openai";
import { LLM_CONFIG } from "@/lib/config";
import { validateGrounding, type PlaybookStep, type LLMStep } from "./validate-grounding";

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

export type GenerateInput = {
  finalLabel: string;
  labelDisplayName: string;
  playbookSteps: PlaybookStep[];
  textChunks: { id: string; content: string; metadata?: unknown }[];
  userText: string;
  imageMatchesSummary: string;
  machineModel?: string;
  /** Canonical machine specs from machine_specs table for direct lookup (e.g. amps, fuse, dimensions). */
  machineSpecs?: Record<string, unknown>;
};

export type GenerateResult = {
  diagnosis: string;
  steps: { step_id: string; instruction: string; check?: string }[];
  why: string;
  retakeTips?: string[];
  citations?: { chunkId: string; reason: string }[];
  /** 1–3 short questions to narrow down which cause/step applies; omit or empty when not needed */
  followUpQuestions?: string[];
};

const SYSTEM_PROMPT = `You are a support assistant. You must ONLY use the provided playbook steps. Do not invent new steps.
Output valid JSON with this exact structure (no other text):
{
  "diagnosis": "short diagnosis",
  "steps": [{"step_id": "<must be one of the provided step_ids>", "instruction": "what to do", "check": "how to verify"}],
  "why": "brief explanation citing the match and playbook",
  "retakeTips": ["optional tip if photo was unclear"],
  "citations": [{"chunkId": "id", "reason": "why cited"}],
  "followUpQuestions": ["optional question 1", "optional question 2"]
}
Every step_id in "steps" MUST be one of the step_ids from the playbook.
When there are multiple possible causes (multiple steps), include 1–3 short followUpQuestions that help the user narrow down which cause applies (e.g. "Have you been pulling a lot of product in a short time?", "When did you last clean the air tube?"). Omit followUpQuestions or use [] when a single cause is clear.`;

export async function generateAnswer(
  input: GenerateInput,
  retryWithStrictPrompt = false
): Promise<GenerateResult> {
  const stepIdsList = input.playbookSteps.map((s) => s.step_id).join(", ");
  const playbookText = input.playbookSteps
    .map(
      (s) =>
        `- step_id: ${s.step_id}, title: ${s.title ?? ""}, instruction: ${s.instruction ?? ""}, check: ${s.check ?? ""}, if_failed: ${s.if_failed ?? ""}`
    )
    .join("\n");
  const chunksText = input.textChunks
    .map((c) => `[id: ${c.id}]\n${c.content.slice(0, 500)}`)
    .join("\n\n");

  const machineLine =
    input.machineModel != null && input.machineModel !== ""
      ? `\nMachine model: ${input.machineModel}\n`
      : "";
  const specsBlock =
    input.machineSpecs && Object.keys(input.machineSpecs).length > 0
      ? `\nMachine specs (canonical; use for exact values like amps, fuse, dimensions):\n${JSON.stringify(input.machineSpecs)}\n`
      : "";
  const userContent = retryWithStrictPrompt
    ? `You must only use these step_ids: ${stepIdsList}. Do not use any other step_id.\n\n` +
      `Playbook steps:\n${playbookText}\n\nText chunks:\n${chunksText}\n\nUser: ${input.userText}${machineLine}${specsBlock}\n\nImage matches: ${input.imageMatchesSummary}`
    : `Label: ${input.labelDisplayName} (${input.finalLabel})\n\nPlaybook steps:\n${playbookText}\n\nText chunks:\n${chunksText}\n\nUser: ${input.userText}${machineLine}${specsBlock}\n\nImage matches: ${input.imageMatchesSummary}`;

  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.generationModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });
  const text = res.choices[0]?.message?.content;
  if (!text) throw new Error("Empty generation response");
  const parsed = JSON.parse(text) as GenerateResult;
  return parsed;
}

export async function generateAnswerWithValidation(
  input: GenerateInput
): Promise<GenerateResult> {
  let result = await generateAnswer(input);
  const llmSteps: LLMStep[] = result.steps.map((s) => ({
    step_id: s.step_id,
    instruction: s.instruction,
    check: s.check,
  }));
  const validation = validateGrounding(llmSteps, input.playbookSteps);
  if (!validation.valid) {
    result = await generateAnswer(input, true);
  }
  return result;
}
