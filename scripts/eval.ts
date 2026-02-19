/**
 * Outcome-linked evaluation runner.
 *
 * Usage: npm run eval
 * Reads cases from:
 *  - data/eval_cases.json (preferred)
 *  - data/test_cases.json (legacy fallback)
 *
 * Supports quality gates for CI/nightly regression:
 *  - wrong-confident rate < EVAL_MAX_WRONG_CONFIDENT (default 0.02)
 *  - unsafe non-escalation rate <= EVAL_MAX_UNSAFE_NON_ESCALATION (default 0.0)
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { join } from "path";
import { runAnalysis } from "../src/lib/pipeline/analyse";

type TestCase = {
  id?: string;
  text: string;
  imagePaths?: string[];
  expectedLabel?: string;
  expectedOutcome?:
    | "resolved_correct"
    | "resolved_incorrect"
    | "safe_escalation"
    | "unsafe_non_escalation";
  machineModel?: string;
  minExpectedConfidence?: number;
};

function getNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadTestCases(): Promise<TestCase[]> {
  const preferred = join(process.cwd(), "data", "eval_cases.json");
  const fallback = join(process.cwd(), "data", "test_cases.json");
  for (const path of [preferred, fallback]) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data as TestCase[];
    } catch {
      // continue
    }
  }
  return [];
}

async function runTestCase(tc: TestCase): Promise<{
  predictedLabel: string;
  confidence: number;
  unknown: boolean;
  durationMs: number;
}> {
  const imageBuffers: Buffer[] = [];
  for (const rel of tc.imagePaths ?? []) {
    const abs = join(process.cwd(), rel);
    const { readFile: read } = await import("fs/promises");
    imageBuffers.push(await read(abs));
  }
  const start = Date.now();
  const result = await runAnalysis({
    userText: tc.text,
    imageBuffers,
    machineModel: tc.machineModel,
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
  const allCases = await loadTestCases();
  const caseLimitRaw = getNumberEnv("EVAL_CASE_LIMIT", 0);
  const caseLimit = caseLimitRaw > 0 ? Math.floor(caseLimitRaw) : 0;
  const cases = caseLimit > 0 ? allCases.slice(0, caseLimit) : allCases;
  if (cases.length === 0) {
    console.log("No test cases in data/test_cases.json");
    process.exit(0);
  }

  console.log(`Running ${cases.length} test case(s)...`);
  console.log(
    `Hybrid weights: rank=${process.env.RETRIEVAL_TEXT_KEYWORD_RANK_WEIGHT ?? "default"} exactBoost=${process.env.RETRIEVAL_TEXT_EXACT_MATCH_BOOST ?? "default"}\n`
  );
  let labelEvaluated = 0;
  let correct = 0;
  let unknownCount = 0;
  let wrongConfidentCount = 0;
  let resolvedIncorrectCount = 0;
  let unsafeNonEscalationCount = 0;
  let unsafeNonEscalationLabelCount = 0;
  let escalationExpectedCount = 0;
  let escalationMissCount = 0;
  const times: number[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    process.stdout.write(`  [${i + 1}/${cases.length}] ${tc.text.slice(0, 40)}... `);
    try {
      const out = await runTestCase(tc);
      times.push(out.durationMs);
      if (tc.expectedLabel) {
        labelEvaluated++;
        if (out.predictedLabel === tc.expectedLabel) correct++;
      }
      if (out.unknown) unknownCount++;
      const wrongConfident =
        Boolean(tc.expectedLabel) &&
        out.predictedLabel !== tc.expectedLabel &&
        !out.unknown &&
        out.confidence >= (tc.minExpectedConfidence ?? 0.5);
      if (wrongConfident) wrongConfidentCount++;
      if (tc.expectedOutcome === "resolved_incorrect") {
        resolvedIncorrectCount++;
      }
      if (tc.expectedOutcome === "unsafe_non_escalation") unsafeNonEscalationLabelCount++;
      if (
        tc.expectedOutcome === "safe_escalation" ||
        tc.expectedOutcome === "unsafe_non_escalation"
      ) {
        escalationExpectedCount++;
        if (!out.unknown) {
          escalationMissCount++;
          if (tc.expectedOutcome === "unsafe_non_escalation") unsafeNonEscalationCount++;
        }
      }
      console.log(
        `${out.predictedLabel} (expected ${tc.expectedLabel ?? "n/a"}) ${out.durationMs}ms`
      );
    } catch (err) {
      console.log("ERROR:", err instanceof Error ? err.message : err);
    }
  }

  const avgTime =
    times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const labelAccuracy =
    labelEvaluated > 0 ? (100 * correct) / labelEvaluated : 0;
  const wrongConfidentRate = cases.length > 0 ? wrongConfidentCount / cases.length : 0;
  const unsafeNonEscalationRate =
    escalationExpectedCount > 0 ? unsafeNonEscalationCount / escalationExpectedCount : 0;
  const escalationMissRate =
    escalationExpectedCount > 0 ? escalationMissCount / escalationExpectedCount : 0;

  console.log("\n--- Results ---");
  console.log(
    `Label accuracy: ${correct}/${labelEvaluated} (${labelAccuracy.toFixed(1)}%)`
  );
  console.log(`Unknown rate: ${unknownCount}/${cases.length} (${((100 * unknownCount) / cases.length).toFixed(1)}%)`);
  console.log(
    `Wrong-confident rate: ${wrongConfidentCount}/${cases.length} (${(
      100 * wrongConfidentRate
    ).toFixed(1)}%)`
  );
  console.log(
    `Escalation miss rate: ${escalationMissCount}/${escalationExpectedCount} (${(
      100 * escalationMissRate
    ).toFixed(1)}%)`
  );
  console.log(
    `Unsafe non-escalation labels in dataset: ${unsafeNonEscalationLabelCount}`
  );
  console.log(
    `Resolved incorrect labels in dataset: ${resolvedIncorrectCount}`
  );
  console.log(`Avg time per run: ${avgTime.toFixed(0)}ms`);

  const maxWrongConfident = Number(process.env.EVAL_MAX_WRONG_CONFIDENT ?? "0.02");
  const maxUnsafeNonEscalation = Number(
    process.env.EVAL_MAX_UNSAFE_NON_ESCALATION ?? "0"
  );

  let failed = false;
  if (wrongConfidentRate > maxWrongConfident) {
    console.error(
      `QUALITY GATE FAILED: wrong-confident rate ${wrongConfidentRate.toFixed(
        4
      )} > ${maxWrongConfident}`
    );
    failed = true;
  }
  if (unsafeNonEscalationRate > maxUnsafeNonEscalation) {
    console.error(
      `QUALITY GATE FAILED: unsafe non-escalation rate ${unsafeNonEscalationRate.toFixed(
        4
      )} > ${maxUnsafeNonEscalation}`
    );
    failed = true;
  }
  if (failed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
