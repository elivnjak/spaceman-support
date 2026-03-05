import { db } from "@/lib/db";
import { docChunks } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { getConfidenceConfig, getRetrievalConfig } from "@/lib/config";
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
  limit?: number,
  machineModel?: string | null,
  labelId?: string,
  keywordQuery?: string
): Promise<TextChunkMatch[]> {
  const [confidenceConfig, retrievalConfig] = await Promise.all([
    getConfidenceConfig(),
    getRetrievalConfig(),
  ]);
  const resolvedLimit = limit ?? retrievalConfig.textTopN;
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  const minChunkScore = confidenceConfig.minChunkScore;
  const canonical = toCanonicalModel(machineModel);
  const withPrefix = canonical ? `SM-${canonical}` : null;
  const normalizedKeyword = keywordQuery?.trim().replace(/\s+/g, " ") ?? "";
  const keywordPattern =
    normalizedKeyword.length > 0 ? `%${normalizedKeyword.toLowerCase()}%` : null;
  const titleTextExpr = sql`COALESCE(dc.metadata->>'title', '')`;
  const tagsTextExpr = sql`COALESCE((
    SELECT string_agg(tag, ' ')
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(dc.metadata->'tags') = 'array' THEN dc.metadata->'tags'
        ELSE '[]'::jsonb
      END
    ) AS tag
  ), '')`;
  const searchableTextExpr = sql`concat_ws(' ', coalesce(dc.content, ''), ${titleTextExpr}, ${tagsTextExpr})`;
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
      ? sql`(
            ${
              useIndexedSearchVector
                ? sql`ts_rank_cd(
                    dc.search_vector,
                    plainto_tsquery('english', ${normalizedKeyword})
                  )`
                : sql`ts_rank_cd(
                    to_tsvector('english', coalesce(dc.content, '')),
                    plainto_tsquery('english', ${normalizedKeyword})
                  )`
            }
            + (
              ts_rank_cd(
                to_tsvector('english', concat_ws(' ', ${titleTextExpr}, ${tagsTextExpr})),
                plainto_tsquery('english', ${normalizedKeyword})
              ) * 0.7
            )
          )`
      : sql`0`;
  const literalBoostExpr = keywordPattern
    ? sql`CASE WHEN LOWER(${searchableTextExpr}) LIKE ${keywordPattern} THEN ${sql.raw(String(retrievalConfig.textExactMatchBoost))} ELSE 0 END`
    : sql`0`;

  const runHybridQuery = async (
    useIndexedSearchVector: boolean,
    machineMatchOnly: boolean
  ): Promise<{ rows: Record<string, unknown>[] }> => {
    const ftsRankExpr = buildFtsRankExpr(useIndexedSearchVector);
    const hybridScoreExpr = sql`${similarityExpr} + (${ftsRankExpr} * ${sql.raw(String(retrievalConfig.textKeywordRankWeight))}) + ${literalBoostExpr}`;
    const baseWhere = sql`dc.embedding IS NOT NULL AND ${similarityExpr} >= ${minChunkScore} ${labelFilter}`;
    const machineMatchFilter =
      machineMatchOnly && canonical
        ? sql`AND (${likeCanonical} OR ${likeWithPrefix})`
        : sql``;

    const result = await db.execute(sql`
      SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.metadata,
             ${similarityExpr} AS similarity
      FROM doc_chunks dc
      LEFT JOIN documents d ON d.id = dc.document_id
      WHERE ${baseWhere}
        ${machineMatchFilter}
      ORDER BY ${hybridScoreExpr} DESC, ${similarityExpr} DESC
      LIMIT ${machineMatchOnly ? retrievalConfig.textMachineMatchedReserve : resolvedLimit}
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: Record<string, unknown>[] }).rows ?? [];
    return { rows };
  };

  const runQueries = async (useIndexedSearchVector: boolean) => {
    const hasMachine = machineModel != null && machineModel !== "";
    const reserve = hasMachine ? retrievalConfig.textMachineMatchedReserve : 0;

    if (reserve > 0) {
      const [machineRaw, allRaw] = await Promise.all([
        runHybridQuery(useIndexedSearchVector, true),
        runHybridQuery(useIndexedSearchVector, false),
      ]);
      const machineRows = machineRaw.rows;
      const allRows = allRaw.rows;
      const seen = new Set<string>();
      const merged: Record<string, unknown>[] = [];
      for (const r of machineRows) {
        const id = r.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(r);
        }
      }
      for (const r of allRows) {
        if (merged.length >= resolvedLimit) break;
        const id = r.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(r);
        }
      }
      return merged;
    }

    const { rows } = await runHybridQuery(useIndexedSearchVector, false);
    return rows;
  };

  let rows: Record<string, unknown>[];
  try {
    rows = await runQueries(true);
  } catch (error) {
    const pgCode = (error as { code?: string } | undefined)?.code;
    if (pgCode !== "42703") throw error; // undefined_column
    rows = await runQueries(false);
  }

  return rows
    .map((r: Record<string, unknown>) => ({
      id: r.id as string,
      documentId: r.document_id as string,
      chunkIndex: Number(r.chunk_index),
      content: r.content as string,
      metadata: r.metadata,
      similarity: Number(r.similarity),
    }))
    .filter((c) => c.similarity >= confidenceConfig.minChunkScore);
}
