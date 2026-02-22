import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { LLM_CONFIG } from "@/lib/config";
import { db } from "@/lib/db";
import { supportedModels } from "@/lib/db/schema";
import { toCanonicalModel } from "@/lib/ingestion/extract-machine-model";

export interface NameplateResult {
  modelNumber: string | null;
  serialNumber: string | null;
  confidence: number;
  rawText: string;
}

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

export async function analyzeNameplate(imageBuffers: Buffer[]): Promise<NameplateResult> {
  if (imageBuffers.length === 0) {
    return {
      modelNumber: null,
      serialNumber: null,
      confidence: 0,
      rawText: "",
    };
  }

  const systemPrompt = `You extract machine nameplate details from photos.
Return JSON only with this exact shape:
{
  "model_number": "string | null",
  "serial_number": "string | null",
  "confidence": "number 0..1",
  "raw_text": "string"
}
Rules:
- Read only what is visible in the image.
- Preserve punctuation and dashes in model_number and serial_number.
- If uncertain, return null for that field and lower confidence.
- raw_text should contain the important visible plate text in reading order.`;

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    ...imageBuffers.map((buf) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` },
    })),
    { type: "text" as const, text: "Extract model and serial number from this machine name plate." },
  ];

  const res = await getOpenAI().chat.completions.create({
    model: LLM_CONFIG.classificationModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  const text = res.choices[0]?.message?.content ?? "{}";
  let parsed: {
    model_number?: string | null;
    serial_number?: string | null;
    confidence?: number;
    raw_text?: string;
  } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  const modelNumber = parsed.model_number?.trim() || null;
  const serialNumber = parsed.serial_number?.trim() || null;

  return {
    modelNumber,
    serialNumber,
    confidence: clamp01(Number(parsed.confidence ?? 0)),
    rawText: parsed.raw_text?.trim() || "",
  };
}

export function parseManufacturingYear(serial: string): number | null {
  const normalized = (serial ?? "").trim();
  if (!normalized) return null;
  const match = normalized.match(/^(\d{2})/);
  if (!match) return null;
  const yy = Number(match[1]);
  if (!Number.isFinite(yy)) return null;

  const currentYear = new Date().getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  let year = currentCentury + yy;
  if (year > currentYear + 1) {
    year -= 100;
  }
  if (year < 1990 || year > currentYear + 1) return null;
  return year;
}

export async function validateModel(
  modelNumber: string
): Promise<{ valid: boolean; canonical: string }> {
  const canonical = toCanonicalModel(modelNumber) ?? "";
  if (!canonical) return { valid: false, canonical: "" };

  const row = await db.query.supportedModels.findFirst({
    where: eq(supportedModels.modelNumber, canonical),
    columns: { id: true },
  });
  return { valid: Boolean(row), canonical };
}
