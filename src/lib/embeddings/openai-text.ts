import OpenAI from "openai";
import type { TextEmbedder } from "./index";
import { EMBEDDING_CONFIG } from "@/lib/config";
import { withRetry } from "@/lib/retry";

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: key });
}

/**
 * Safety-truncate a single text so it stays under the embedding model's token limit.
 * text-embedding-3-small supports 8191 tokens; at worst ~2 chars/token for technical
 * content, so we cap at 16000 chars (~8000 tokens). This is a last-resort safeguard;
 * the chunker should already produce smaller chunks.
 */
const EMBED_MAX_CHARS = 16_000;
function safeEmbedInput(text: string): string {
  if (text.length <= EMBED_MAX_CHARS) return text;
  const truncated = text.slice(0, EMBED_MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > EMBED_MAX_CHARS * 0.8 ? truncated.slice(0, lastSpace) : truncated;
}

const EXPECTED_DIMENSIONS = EMBEDDING_CONFIG.openaiTextDimensions;

function checkDimensions(vec: number[], context: string): void {
  if (vec.length !== EXPECTED_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: got ${vec.length}, expected ${EXPECTED_DIMENSIONS}. ${context}`
    );
  }
}

export const openaiTextEmbedder: TextEmbedder = {
  async embed(text: string): Promise<number[]> {
    return withRetry(async () => {
      const openai = getOpenAI();
      const res = await openai.embeddings.create({
        model: EMBEDDING_CONFIG.openaiTextModel,
        input: safeEmbedInput(text),
        dimensions: EXPECTED_DIMENSIONS,
      });
      const vec = res.data[0]?.embedding;
      if (!vec) throw new Error("OpenAI embedding returned empty");
      checkDimensions(vec, "Query embedding must match doc_chunks.embedding vector(1536).");
      return vec;
    });
  },

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return withRetry(async () => {
      const openai = getOpenAI();
      const res = await openai.embeddings.create({
        model: EMBEDDING_CONFIG.openaiTextModel,
        input: texts.map(safeEmbedInput),
        dimensions: EXPECTED_DIMENSIONS,
      });
      const sorted = res.data.sort((a, b) => a.index - b.index);
      const embeddings = sorted.map((d) => d.embedding);
      for (let i = 0; i < embeddings.length; i++) {
        checkDimensions(
          embeddings[i],
          `Chunk embedding at index ${i} must match doc_chunks.embedding vector(1536).`
        );
      }
      return embeddings;
    });
  },
};
