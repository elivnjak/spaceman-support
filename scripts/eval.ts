/**
 * Evaluation runner: runs test cases against the analyse pipeline and
 * optionally multi-turn diagnostic scenarios against the planner.
 *
 * Reports:
 *   - Label accuracy, per-label precision/recall, confusion matrix
 *   - Unknown rate
 *   - Average time per run
 *   - (Multi-turn) resolution vs escalation rate, turns-to-resolution,
 *     evidence completeness, cause accuracy
 *
 * Usage:
 *   npm run eval                         # classification only
 *   npm run eval -- --multi-turn         # also run diagnostic scenarios
 *   npm run eval -- --scenario runny-warm-hopper   # run one scenario
 */

import "dotenv/config";
import { readFile } from "fs/promises";
import { join } from "path";

type TestCase = {
  text: string;
  imagePaths: string[];
  expectedLabel: string;
  machineModel?: string;
};

type DiagnosticScenario = {
  id: string;
  description: string;
  expectedLabel: string;
  expectedCause: string | null;
  expectedOutcome: "resolved" | "escalated";
  machineModel?: string;
  turns: { user: string }[];
  expectedEvidenceIds: string[];
};

async function loadTestCases(): Promise<TestCase[]> {
  const path = join(process.cwd(), "data", "test_cases.json");
  const raw = await readFile(path, "utf-8");
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [];
}

async function loadScenarios(): Promise<DiagnosticScenario[]> {
  const path = join(process.cwd(), "data", "diagnostic_scenarios.json");
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function runTestCase(tc: TestCase): Promise<{
  predictedLabel: string;
  confidence: number;
  unknown: boolean;
  durationMs: number;
}> {
  void tc;
  throw new Error(
    "Classification eval is no longer available because the analyse pipeline was removed."
  );
}

type ConfusionEntry = { predicted: string; expected: string };

function printConfusionMatrix(entries: ConfusionEntry[], allLabels: string[]) {
  const matrix = new Map<string, Map<string, number>>();
  for (const l of allLabels) {
    matrix.set(l, new Map(allLabels.map((ll) => [ll, 0])));
  }
  for (const e of entries) {
    const row = matrix.get(e.expected);
    if (row) row.set(e.predicted, (row.get(e.predicted) ?? 0) + 1);
  }

  const header = ["Expected \\ Predicted", ...allLabels].map((s) => s.padEnd(16)).join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const expected of allLabels) {
    const row = matrix.get(expected)!;
    const cells = allLabels.map((p) => String(row.get(p) ?? 0).padEnd(16));
    console.log([expected.padEnd(16), ...cells].join(" | "));
  }
}

function printPerLabelMetrics(entries: ConfusionEntry[], allLabels: string[]) {
  console.log("\nPer-label precision / recall / F1:");
  for (const label of allLabels) {
    const tp = entries.filter((e) => e.predicted === label && e.expected === label).length;
    const fp = entries.filter((e) => e.predicted === label && e.expected !== label).length;
    const fn = entries.filter((e) => e.predicted !== label && e.expected === label).length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    console.log(
      `  ${label.padEnd(16)} P=${(precision * 100).toFixed(1).padStart(5)}%  R=${(recall * 100).toFixed(1).padStart(5)}%  F1=${(f1 * 100).toFixed(1).padStart(5)}%  (TP=${tp} FP=${fp} FN=${fn})`
    );
  }
}

function printCalibrationBuckets(
  results: { confidence: number; correct: boolean }[]
) {
  const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01];
  console.log("\nCalibration (predicted confidence vs actual accuracy):");
  for (let i = 0; i < buckets.length - 1; i++) {
    const lo = buckets[i]!;
    const hi = buckets[i + 1]!;
    const inBucket = results.filter((r) => r.confidence >= lo && r.confidence < hi);
    if (inBucket.length === 0) continue;
    const acc = inBucket.filter((r) => r.correct).length / inBucket.length;
    const avgConf =
      inBucket.reduce((s, r) => s + r.confidence, 0) / inBucket.length;
    console.log(
      `  [${lo.toFixed(1)}, ${(hi - 0.01).toFixed(1)}]  n=${String(inBucket.length).padStart(3)}  avgConf=${(avgConf * 100).toFixed(1).padStart(5)}%  accuracy=${(acc * 100).toFixed(1).padStart(5)}%  gap=${(Math.abs(avgConf - acc) * 100).toFixed(1).padStart(5)}%`
    );
  }
}

async function runClassificationEval() {
  console.log(
    "\n=== Classification Evaluation ===\n\n" +
      "Skipped: the legacy analyse pipeline was removed, so classification eval cases are no longer supported.\n" +
      "Use --multi-turn (or --scenario <id>) to run chat diagnostic evaluation.\n"
  );
}

async function runMultiTurnEval(scenarioFilter?: string) {
  const scenarios = await loadScenarios();
  const toRun = scenarioFilter
    ? scenarios.filter((s) => s.id === scenarioFilter)
    : scenarios;

  if (toRun.length === 0) {
    console.log("No diagnostic scenarios to run");
    return;
  }

  console.log(`\n=== Multi-Turn Diagnostic Evaluation (${toRun.length} scenarios) ===\n`);
  console.log(
    "Note: Multi-turn eval requires a running database with playbooks seeded.\n" +
    "Simulating via HTTP POST to /api/chat — start the dev server first.\n"
  );

  let resolved = 0;
  let escalated = 0;
  let correctOutcome = 0;
  let correctCause = 0;
  let totalTurns = 0;
  let totalEvidenceExpected = 0;
  let totalEvidenceCollected = 0;

  for (const scenario of toRun) {
    process.stdout.write(`  [${scenario.id}] ${scenario.description.slice(0, 50).padEnd(52)} `);
    try {
      let sessionId: string | null = null;
      let lastPhase = "";
      let lastResolution: { causeId?: string } | undefined;
      let lastEscalationReason: string | undefined;
      let turnCount = 0;

      for (const turn of scenario.turns) {
        const form = new FormData();
        form.set("message", turn.user);
        if (sessionId) form.set("sessionId", sessionId);
        if (scenario.machineModel) form.set("machineModel", scenario.machineModel);

        const res = await fetch("http://localhost:3000/api/chat", {
          method: "POST",
          body: form,
        });
        const text = await res.text();
        const events = text.split("\n\n").filter(Boolean);
        for (const evt of events) {
          const dataMatch = evt.match(/data:\s*([\s\S]+)/);
          const eventMatch = evt.match(/event:\s*(\S+)/);
          if (eventMatch?.[1] === "message" && dataMatch?.[1]) {
            const data = JSON.parse(dataMatch[1].trim());
            sessionId = data.sessionId ?? sessionId;
            lastPhase = data.phase ?? lastPhase;
            lastResolution = data.resolution;
            lastEscalationReason = data.escalation_reason;
          }
        }
        turnCount++;

        if (lastPhase === "resolving" || lastPhase === "escalated" || lastPhase === "resolved_followup") {
          break;
        }
      }

      const outcome = lastPhase === "resolving" ? "resolved" : lastPhase === "escalated" ? "escalated" : "incomplete";
      if (outcome === "resolved") resolved++;
      if (outcome === "escalated") escalated++;
      const outcomeCorrect = outcome === scenario.expectedOutcome;
      if (outcomeCorrect) correctOutcome++;

      const causeMatch =
        scenario.expectedCause === null ||
        lastResolution?.causeId === scenario.expectedCause;
      if (causeMatch && outcome === "resolved") correctCause++;
      totalTurns += turnCount;

      console.log(
        `→ ${outcome.padEnd(12)} turns=${turnCount}  ${outcomeCorrect ? "✓" : "✗"}` +
        (outcome === "resolved" ? `  cause=${lastResolution?.causeId ?? "?"}${causeMatch ? " ✓" : " ✗"}` : "") +
        (outcome === "escalated" ? `  reason=${(lastEscalationReason ?? "").slice(0, 40)}` : "")
      );
    } catch (err) {
      console.log("ERROR:", err instanceof Error ? err.message : err);
    }
  }

  const total = toRun.length;
  console.log("\n--- Multi-Turn Results ---");
  console.log(`Resolution rate: ${resolved}/${total} (${total > 0 ? ((100 * resolved) / total).toFixed(1) : 0}%)`);
  console.log(`Escalation rate: ${escalated}/${total} (${total > 0 ? ((100 * escalated) / total).toFixed(1) : 0}%)`);
  console.log(`Correct outcome: ${correctOutcome}/${total} (${total > 0 ? ((100 * correctOutcome) / total).toFixed(1) : 0}%)`);
  console.log(`Correct cause (of resolved): ${correctCause}/${resolved || 1}`);
  console.log(`Avg turns to completion: ${total > 0 ? (totalTurns / total).toFixed(1) : 0}`);
}

async function main() {
  const args = process.argv.slice(2);
  const multiTurn = args.includes("--multi-turn");
  const scenarioIdx = args.indexOf("--scenario");
  const scenarioFilter = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;

  await runClassificationEval();

  if (multiTurn || scenarioFilter) {
    await runMultiTurnEval(scenarioFilter);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
