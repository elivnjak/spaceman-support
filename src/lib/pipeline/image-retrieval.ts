import { db } from "@/lib/db";
import { referenceImages } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { CONFIDENCE_CONFIG, getRetrievalConfig } from "@/lib/config";

export type ImageMatch = {
  referenceImageId: string;
  labelId: string;
  similarity: number;
};

export function aggregateLabelScores(
  matches: ImageMatch[],
  topM: number = CONFIDENCE_CONFIG.topM
): { labelId: string; score: number; matchCount: number }[] {
  const byLabel = new Map<string, ImageMatch[]>();
  for (const m of matches) {
    const list = byLabel.get(m.labelId) ?? [];
    list.push(m);
    byLabel.set(m.labelId, list);
  }
  return Array.from(byLabel.entries())
    .map(([labelId, labelMatches]) => {
      const sorted = labelMatches
        .slice()
        .sort((a, b) => b.similarity - a.similarity);
      const top = sorted.slice(0, topM);
      const score =
        top.length === 0 ? 0 : top.reduce((s, m) => s + m.similarity, 0) / top.length;
      return { labelId, score, matchCount: labelMatches.length };
    })
    .sort((a, b) => b.score - a.score);
}

export async function searchReferenceImages(
  queryEmbedding: number[],
  limit?: number,
  provider?: "replicate" | "huggingface"
): Promise<ImageMatch[]> {
  const retrievalConfig = await getRetrievalConfig();
  const resolvedLimit = limit ?? retrievalConfig.imageTopK;
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  const minScore = 0.1;
  const raw = await db.execute(sql`
    SELECT id, label_id,
           1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM reference_images
    WHERE embedding IS NOT NULL
      ${provider ? sql`AND embedding_provider = ${provider}` : sql``}
      AND (1 - (embedding <=> ${vectorStr}::vector)) >= ${minScore}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${resolvedLimit}
  `);
  type Row = { id: string; label_id: string; similarity: number };
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Row[];

  return rows.map((r) => ({
    referenceImageId: r.id,
    labelId: r.label_id,
    similarity: Number(r.similarity),
  }));
}
