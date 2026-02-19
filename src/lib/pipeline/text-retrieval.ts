import { db } from "@/lib/db";
import { docChunks } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { CONFIDENCE_CONFIG, RETRIEVAL_CONFIG } from "@/lib/config";
import { toCanonicalModel } from "@/lib/ingestion/extract-machine-model";

export type TextChunkMatch = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata: unknown;
  similarity: number;
};

export async function searchDocChunks(
  queryEmbedding: number[],
  limit: number = RETRIEVAL_CONFIG.textTopN,
  machineModel?: string | null,
  labelId?: string,
  keywordQuery?: string
): Promise<TextChunkMatch[]> {
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  const minChunkScore = CONFIDENCE_CONFIG.minChunkScore;
  const canonical = toCanonicalModel(machineModel);
  const withPrefix = canonical ? `SM-${canonical}` : null;
  const normalizedKeyword = keywordQuery?.trim().replace(/\s+/g, " ") ?? "";
  const keywordPattern =
    normalizedKeyword.length > 0 ? `%${normalizedKeyword.toLowerCase()}%` : null;
  // Document machine_model can be comma-separated (e.g. "6210-C, 6220, 6228"). Match if list contains canonical or SM- prefix form.
  const listNorm = sql`(',' || replace(replace(coalesce(d.machine_model, ''), ' ', ''), ', ', ',') || ',')`;
  const likeCanonical = canonical ? sql`${listNorm} LIKE ${"%," + canonical + ",%"}` : sql`false`;
  const likeWithPrefix = withPrefix ? sql`${listNorm} LIKE ${"%," + withPrefix + ",%"}` : sql`false`;
  const labelFilter = labelId
    ? sql`AND (d.label_ids IS NULL OR d.label_ids @> ${JSON.stringify([labelId])}::jsonb)`
    : sql``;
  const similarityExpr = sql`1 - (dc.embedding <=> ${vectorStr}::vector)`;
  const buildFtsRankExpr = (useIndexedSearchVector: boolean) =>
    normalizedKeyword.length > 0
      ? useIndexedSearchVector
        ? sql`ts_rank_cd(
            dc.search_vector,
            plainto_tsquery('english', ${normalizedKeyword})
          )`
        : sql`ts_rank_cd(
            to_tsvector('english', coalesce(dc.content, '')),
            plainto_tsquery('english', ${normalizedKeyword})
          )`
      : sql`0`;
  const literalBoostExpr = keywordPattern
    ? sql`CASE WHEN LOWER(dc.content) LIKE ${keywordPattern} THEN ${sql.raw(String(RETRIEVAL_CONFIG.textExactMatchBoost))} ELSE 0 END`
    : sql`0`;

  const runHybridQuery = async (useIndexedSearchVector: boolean) => {
    const ftsRankExpr = buildFtsRankExpr(useIndexedSearchVector);
    const hybridScoreExpr = sql`${similarityExpr} + (${ftsRankExpr} * ${sql.raw(String(RETRIEVAL_CONFIG.textKeywordRankWeight))}) + ${literalBoostExpr}`;
    return machineModel != null && machineModel !== ""
      ? db.execute(sql`
          SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.metadata,
                 ${similarityExpr} AS similarity
          FROM doc_chunks dc
          LEFT JOIN documents d ON d.id = dc.document_id
          WHERE dc.embedding IS NOT NULL
            AND ${similarityExpr} >= ${minChunkScore}
            ${labelFilter}
          ORDER BY CASE WHEN ${likeCanonical} OR ${likeWithPrefix} THEN 0 ELSE 1 END,
                   ${hybridScoreExpr} DESC,
                   ${similarityExpr} DESC
          LIMIT ${limit}
        `)
      : db.execute(sql`
          SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.metadata,
                 ${similarityExpr} AS similarity
          FROM doc_chunks dc
          LEFT JOIN documents d ON d.id = dc.document_id
          WHERE dc.embedding IS NOT NULL
            AND ${similarityExpr} >= ${minChunkScore}
            ${labelFilter}
          ORDER BY ${hybridScoreExpr} DESC,
                   ${similarityExpr} DESC
          LIMIT ${limit}
        `);
  };

  let raw: unknown;
  try {
    raw = await runHybridQuery(true);
  } catch (error) {
    const pgCode = (error as { code?: string } | undefined)?.code;
    if (pgCode !== "42703") throw error; // undefined_column
    raw = await runHybridQuery(false);
  }
  const rows = Array.isArray(raw)
    ? raw
    : (raw as { rows?: Record<string, unknown>[] }).rows ?? [];

  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    documentId: r.document_id as string,
    chunkIndex: Number(r.chunk_index),
    content: r.content as string,
    metadata: r.metadata,
    similarity: Number(r.similarity),
  }));
}
