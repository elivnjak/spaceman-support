import OpenAI from "openai";
import {
  estimateOpenAIRequestTokens,
  withOpenAIRetry,
} from "@/lib/openai/retry";

export type SentimentSignal = {
  frustrationLevel: "none" | "mild" | "moderate" | "high";
  escalationIntent: boolean;
  reasoning: string;
};

export type SentimentClassifierInput = {
  /** The user's latest message to classify. */
  latestMessage: string;
  /** Last 2–3 conversation turns for context (e.g. tone building over time). */
  recentMessages: { role: string; content?: string }[];
};

const SENTIMENT_MODEL = "gpt-4o-mini";
const SENTIMENT_MAX_COMPLETION_TOKENS = 120;

const OUTPUT_SCHEMA = `Respond with valid JSON only. Schema:
{
  "frustrationLevel": "none" | "mild" | "moderate" | "high",
  "escalationIntent": boolean,
  "reasoning": "string (one short sentence for audit)"
}
- frustrationLevel: "none" = calm, cooperative; "mild" = slightly impatient or tired; "moderate" = clearly frustrated or annoyed; "high" = very frustrated, angry, or explicitly asking to stop and speak to a human.
- Treat factual responses (e.g. "I don't know"), numeric readings (e.g. "-10", "32"), or simple skip-style responses as "none" unless the text also contains clear frustration language.
- escalationIntent: true only if the user explicitly asks to talk to a human, technician, support, or to be connected/escalated.
- reasoning: one sentence explaining why you chose this level (for logging).`;

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

/**
 * Classifies the user's latest message for frustration level and escalation intent.
 * Uses gpt-4o-mini for low latency and cost. Run in parallel with RAG to hide latency.
 */
export async function runSentimentClassifier(
  input: SentimentClassifierInput
): Promise<SentimentSignal> {
  const recentConv =
    input.recentMessages
      .slice(-4)
      .map((m) =>
        JSON.stringify({
          role: m.role,
          content: (m.content ?? "").trim().replace(/\u0000/g, ""),
        })
      )
      .join("\n") || "(no prior messages)";

  const userContent = `Recent conversation (last few turns):
${recentConv}

Latest user message to classify:
${JSON.stringify((input.latestMessage ?? "").replace(/\u0000/g, ""))}

Rate the user's frustration level and whether they want to speak to a human. Output JSON only.`;

  const openai = getOpenAI();
  const systemPrompt = `You are a sentiment classifier for a technical support chat. Your job is to detect user frustration and whether they want to be connected to a human/technician.

${OUTPUT_SCHEMA}`;
  const estimatedTokens = estimateOpenAIRequestTokens({
    texts: [systemPrompt, userContent],
    maxCompletionTokens: SENTIMENT_MAX_COMPLETION_TOKENS,
  });
  const res = await withOpenAIRetry(
    "sentiment_classifier",
    () =>
      openai.chat.completions.create({
        model: SENTIMENT_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: SENTIMENT_MAX_COMPLETION_TOKENS,
      }),
    { estimatedTokens }
  );

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) {
    return {
      frustrationLevel: "none",
      escalationIntent: false,
      reasoning: "No response from classifier",
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const level = parsed?.frustrationLevel;
    const validLevels: SentimentSignal["frustrationLevel"][] = [
      "none",
      "mild",
      "moderate",
      "high",
    ];
    const frustrationLevel =
      typeof level === "string" && validLevels.includes(level as SentimentSignal["frustrationLevel"])
        ? (level as SentimentSignal["frustrationLevel"])
        : "none";
    const escalationIntent = Boolean(parsed?.escalationIntent);
    const reasoning =
      typeof parsed?.reasoning === "string"
        ? parsed.reasoning.slice(0, 200)
        : "No reasoning provided";

    return { frustrationLevel, escalationIntent, reasoning };
  } catch {
    return {
      frustrationLevel: "none",
      escalationIntent: false,
      reasoning: "Classifier output was invalid JSON",
    };
  }
}
