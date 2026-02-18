/**
 * Test script for the two-pass PDF ingestion pipeline.
 * Run with: npx tsx scripts/test-pdf-ingestion.ts [path-to.pdf]
 * Default path: data/6220E.pdf (copy the spec sheet there if testing locally).
 *
 * Verifies: extractPdfPages, page routing heuristic, chunking with page metadata and KV flattening.
 * If OPENAI_API_KEY is set, also runs vision extraction and numeric verification (costs API tokens).
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  extractPdfPages,
  getFullTextFromPages,
  getTableHeavyPageNumbers,
  scorePageAsTableHeavy,
} from "../src/lib/ingestion/pdf-text-extractor";
import { chunkMarkdownOrText, flattenTablesToKV } from "../src/lib/ingestion/chunker";
import { verifyNumerics } from "../src/lib/ingestion/verify-numerics";
import { extractPagesWithVision } from "../src/lib/ingestion/pdf-vision-extractor";
import { extractSpecsFromMarkdown } from "../src/lib/ingestion/extract-specs";

async function main() {
  const pdfPath = process.argv[2] ?? join(process.cwd(), "data", "6220E.pdf");
  console.log("PDF path:", pdfPath);

  let buffer: Buffer;
  try {
    buffer = await readFile(pdfPath);
  } catch (e) {
    console.log("Could not read PDF file. Create data/6220E.pdf or pass a path.");
    process.exit(1);
  }

  console.log("\n--- Pass 1: Deterministic extraction (pdfjs-dist) ---");
  const pages = await extractPdfPages(buffer);
  console.log("Pages:", pages.length);
  const fullText = getFullTextFromPages(pages);
  console.log("Full text length:", fullText.length);

  console.log("\n--- Page routing (table-heavy heuristic) ---");
  const tableHeavy = getTableHeavyPageNumbers(pages);
  console.log("Table-heavy page numbers:", tableHeavy.join(", ") || "(none)");
  for (const p of pages) {
    const score = scorePageAsTableHeavy(p);
    console.log(`  Page ${p.pageNum}: score ${score.toFixed(2)} ${score >= 0.6 ? "[VISION]" : ""}`);
  }

  if (tableHeavy.length > 0 && process.env.OPENAI_API_KEY) {
    console.log("\n--- Pass 2: Vision extraction (Responses API) ---");
    try {
      const vision = await extractPagesWithVision(buffer, tableHeavy);
      console.log("Vision markdown length:", vision.markdown.length);
      console.log("First 500 chars:", vision.markdown.slice(0, 500));

      console.log("\n--- Numeric verification ---");
      const verification = verifyNumerics(vision.markdown, pages, vision.pagesProcessed);
      console.log("Status:", verification.status, verification.detail ?? "");

      console.log("\n--- Chunking (heading + page metadata) ---");
      const chunks = chunkMarkdownOrText(vision.markdown, "md");
      console.log("Chunks:", chunks.length);
      for (let i = 0; i < Math.min(3, chunks.length); i++) {
        const c = chunks[i]!;
        const kv = flattenTablesToKV(c.content);
        console.log(`  Chunk ${i + 1}: heading=${(c.metadata as { heading?: string }).heading ?? "-"}, page=${(c.metadata as { page?: number }).page ?? "-"}, has KV=${!!kv}`);
        if (kv) console.log("    KV preview:", kv.slice(0, 120) + "...");
      }

      console.log("\n--- Spec extraction (for machine_specs) ---");
      const specs = extractSpecsFromMarkdown(vision.markdown);
      console.log("Sections:", Object.keys(specs).join(", "));
    } catch (err) {
      console.log("Vision/verify error:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("\n--- Fallback chunking (no vision) ---");
    const chunks = chunkMarkdownOrText(fullText, "txt");
    console.log("Chunks (by size):", chunks.length);
  }

  console.log("\nDone.");
}

main();
