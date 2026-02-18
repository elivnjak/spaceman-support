import { db } from "@/lib/db";
import { docChunks } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { RETRIEVAL_CONFIG } from "@/lib/config";
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
  machineModel?: string | null
): Promise<TextChunkMatch[]> {
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  const canonical = toCanonicalModel(machineModel);
  const withPrefix = canonical ? `SM-${canonical}` : null;
  // Document machine_model can be comma-separated (e.g. "6210-C, 6220, 6228"). Match if list contains canonical or SM- prefix form.
  const listNorm = sql`(',' || replace(replace(coalesce(d.machine_model, ''), ' ', ''), ', ', ',') || ',')`;
  const likeCanonical = canonical ? sql`${listNorm} LIKE ${"%," + canonical + ",%"}` : sql`false`;
  const likeWithPrefix = withPrefix ? sql`${listNorm} LIKE ${"%," + withPrefix + ",%"}` : sql`false`;
  const raw =
    machineModel != null && machineModel !== ""
      ? await db.execute(sql`
          SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.metadata,
                 1 - (dc.embedding <=> ${vectorStr}::vector) AS similarity
          FROM doc_chunks dc
          LEFT JOIN documents d ON d.id = dc.document_id
          WHERE dc.embedding IS NOT NULL
          ORDER BY CASE WHEN ${likeCanonical} OR ${likeWithPrefix} THEN 0 ELSE 1 END,
                   dc.embedding <=> ${vectorStr}::vector
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT id, document_id, chunk_index, content, metadata,
                 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM doc_chunks
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${limit}
        `);
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
