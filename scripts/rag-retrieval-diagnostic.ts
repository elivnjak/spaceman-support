/**
 * RAG retrieval diagnostic: embeds a query and lists top chunk similarities
 * WITHOUT the minChunkScore filter to see if the threshold is excluding results.
 *
 * Usage: npx tsx scripts/rag-retrieval-diagnostic.ts
 * Optional: npx tsx scripts/rag-retrieval-diagnostic.ts "Your custom query"
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { openaiTextEmbedder } from "../src/lib/embeddings/openai-text";
import { CONFIDENCE_CONFIG } from "../src/lib/config";

const DEFAULT_QUERY =
  "What is the pull capacity of my machine? too_runny troubleshooting steps causes";

async function main() {
  const queryText = process.argv[2] ?? DEFAULT_QUERY;
  console.log("Query:", queryText);
  console.log("minChunkScore (current threshold):", CONFIDENCE_CONFIG.minChunkScore);
  console.log("");

  const embedding = await openaiTextEmbedder.embed(queryText);
  const vectorStr = `[${embedding.join(",")}]`;

  const result = await db.execute(sql`
    SELECT
      dc.id,
      dc.document_id,
      d.machine_model,
      LEFT(dc.content, 120) AS content_preview,
      (1 - (dc.embedding <=> ${vectorStr}::vector)) AS similarity
    FROM doc_chunks dc
    LEFT JOIN documents d ON d.id = dc.document_id
    WHERE dc.embedding IS NOT NULL
    ORDER BY (1 - (dc.embedding <=> ${vectorStr}::vector)) DESC
    LIMIT 20
  `);

  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: Record<string, unknown>[] }).rows ?? [];

  if (rows.length === 0) {
    console.log("No chunks with non-null embeddings in the database.");
    process.exit(1);
  }

  console.log(`Top ${rows.length} chunks by similarity (no threshold):`);
  console.log("");

  let aboveThreshold = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const sim = Number(r.similarity);
    if (sim >= CONFIDENCE_CONFIG.minChunkScore) aboveThreshold++;
    const pass = sim >= CONFIDENCE_CONFIG.minChunkScore ? " PASS" : " BELOW";
    console.log(
      `  similarity: ${sim.toFixed(4)}${pass}  doc: ${r.document_id}  machine_model: ${r.machine_model ?? "null"}`
    );
    console.log(`    preview: ${String(r.content_preview ?? "").replace(/\n/g, " ")}`);
    console.log("");
  }

  console.log("---");
  console.log(
    `Chunks that would pass threshold (>= ${CONFIDENCE_CONFIG.minChunkScore}): ${aboveThreshold} of ${rows.length}`
  );
  if (aboveThreshold === 0 && rows.length > 0) {
    const top = Number((rows[0] as Record<string, unknown>).similarity);
    console.log(
      `\nRecommendation: Top similarity is ${top.toFixed(4)}. Consider lowering minChunkScore to ${(top - 0.02).toFixed(2)} or adding a fallback when 0 chunks are returned.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
