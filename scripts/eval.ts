/**
 * Evaluation runner: runs test cases from data/test_cases.json against the analyse API.
 * Reports: label accuracy, top-2 accuracy, unknown rate, average time per run.
 *
 * Usage: npm run eval
 * Requires: .env with OPENAI_API_KEY, HUGGINGFACE_API_KEY; server can be running or we call the pipeline directly.
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { join } from "path";
import { runAnalysis } from "../src/lib/pipeline/analyse";

type TestCase = {
  text: string;
  imagePaths: string[];
  expectedLabel: string;
};

async function loadTestCases(): Promise<TestCase[]> {
  const path = join(process.cwd(), "data", "test_cases.json");
  const raw = await readFile(path, "utf-8");
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [];
}

async function runTestCase(tc: TestCase): Promise<{
  predictedLabel: string;
  confidence: number;
  unknown: boolean;
  durationMs: number;
}> {
  const imageBuffers: Buffer[] = [];
  for (const rel of tc.imagePaths) {
    const abs = join(process.cwd(), rel);
    const { readFile: read } = await import("fs/promises");
    imageBuffers.push(await read(abs));
  }
  const start = Date.now();
  const result = await runAnalysis({
    userText: tc.text,
    imageBuffers,
  });
  const durationMs = Date.now() - start;
  return {
    predictedLabel: result.predictedLabel,
    confidence: result.confidence,
    unknown: result.unknown,
    durationMs,
  };
}

async function main() {
  const cases = await loadTestCases();
  if (cases.length === 0) {
    console.log("No test cases in data/test_cases.json");
    process.exit(0);
  }

  console.log(`Running ${cases.length} test case(s)...\n`);
  let correct = 0;
  let top2Correct = 0;
  let unknownCount = 0;
  const times: number[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i + 1}/${cases.length}] ${tc.text.slice(0, 40)}... `);
    try {
      const out = await runTestCase(tc);
      times.push(out.durationMs);
      if (out.predictedLabel === tc.expectedLabel) correct++;
      if (out.unknown) unknownCount++;
      // Top-2: we don't have top-2 from pipeline in result; we could extend runAnalysis to return top 2 labels. For now skip.
      console.log(
        `${out.predictedLabel} (expected ${tc.expectedLabel}) ${out.durationMs}ms`
      );
    } catch (err) {
      console.log("ERROR:", err instanceof Error ? err.message : err);
    }
  }

  const avgTime =
    times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  console.log("\n--- Results ---");
  console.log(`Label accuracy: ${correct}/${cases.length} (${((100 * correct) / cases.length).toFixed(1)}%)`);
  console.log(`Unknown rate: ${unknownCount}/${cases.length} (${((100 * unknownCount) / cases.length).toFixed(1)}%)`);
  console.log(`Avg time per run: ${avgTime.toFixed(0)}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
