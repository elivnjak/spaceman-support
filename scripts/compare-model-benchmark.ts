import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { db, auditLogs } from "@/lib/db";

const DEFAULT_BENCHMARK_SCENARIOS = [
  "generated-resolution-fb-product-not-freezing-3724e28d",
  "generated-resolution-fb-compressor-runs-no-frost-f3b83d5c",
  "generated-resolution-fb-display-alarm-or-error-f9fb7b93",
  "generated-resolution-fb-product-leaking-from-door-045a07aa",
  "generated-resolution-ss-beater-not-turning-210ce883",
  "generated-resolution-ss-first-pull-runny-after-idle-85ffe006",
  "regression-ss-soft-runny-no-supported-cause",
] as const;

const WORKSPACE_DIR = "/Users/elivnjak/Sites/ai-rag-saas";
const BASE_URL = "http://127.0.0.1:3001";

type ScenarioMetrics = {
  plannerCalls: number;
  promptTokens: number;
  totalTokens: number;
  plannerDurationMs: number;
  rateLimitErrors: number;
};

type ScenarioBenchmarkResult = {
  scenarioId: string;
  passed: boolean;
  failureCodes: string[];
  sessionId: string | null;
  reportPath: string | null;
  metrics: ScenarioMetrics | null;
};

function runPlaybookScenario(
  scenarioId: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npm",
      [
        "run",
        "playbook:test",
        "--",
        "--scenario",
        scenarioId,
        "--base-url",
        BASE_URL,
      ],
      {
        cwd: WORKSPACE_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

function extractReportPath(output: string): string | null {
  const match = output.match(/Report:\s+(.+)\s*$/m);
  return match ? match[1].trim() : null;
}

async function loadScenarioReport(
  reportPath: string,
  scenarioId: string
): Promise<Record<string, unknown>> {
  const scenarioPath = path.join(reportPath, "scenarios", `${scenarioId}.json`);
  return JSON.parse(await fs.readFile(scenarioPath, "utf8")) as Record<string, unknown>;
}

async function loadScenarioMetrics(sessionId: string): Promise<ScenarioMetrics> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.sessionId, sessionId))
    .orderBy(asc(auditLogs.turnNumber), asc(auditLogs.createdAt));

  const plannerCalls: Array<{ prompt: number; total: number; duration: number }> =
    [];
  const errors: string[] = [];

  for (const row of rows) {
    const payload = row.payload as Record<string, unknown>;
    const payloadErrors = Array.isArray(payload.errors) ? payload.errors : [];
    for (const error of payloadErrors) {
      if (typeof error === "string") errors.push(error);
    }

    const llmCalls = Array.isArray(payload.llmCalls) ? payload.llmCalls : [];
    for (const call of llmCalls) {
      if (!call || typeof call !== "object") continue;
      const callRecord = call as Record<string, unknown>;
      if (callRecord.name !== "diagnostic_planner") continue;
      const tokensUsed =
        callRecord.tokensUsed && typeof callRecord.tokensUsed === "object"
          ? (callRecord.tokensUsed as Record<string, unknown>)
          : {};
      plannerCalls.push({
        prompt: Number(tokensUsed.prompt_tokens ?? 0),
        total: Number(tokensUsed.total_tokens ?? 0),
        duration: Number(callRecord.durationMs ?? 0),
      });
    }
  }

  return {
    plannerCalls: plannerCalls.length,
    promptTokens: plannerCalls.reduce((sum, item) => sum + item.prompt, 0),
    totalTokens: plannerCalls.reduce((sum, item) => sum + item.total, 0),
    plannerDurationMs: plannerCalls.reduce((sum, item) => sum + item.duration, 0),
    rateLimitErrors: errors.filter((error) => /429|rate limit/i.test(error)).length,
  };
}

async function benchmarkScenario(
  scenarioId: string
): Promise<ScenarioBenchmarkResult> {
  const exec = await runPlaybookScenario(scenarioId);
  const combinedOutput = `${exec.stdout}\n${exec.stderr}`;
  const reportPath = extractReportPath(combinedOutput);
  if (!reportPath) {
    return {
      scenarioId,
      passed: false,
      failureCodes: ["missing_report_path"],
      sessionId: null,
      reportPath: null,
      metrics: null,
    };
  }

  const scenarioReport = await loadScenarioReport(reportPath, scenarioId);
  const failures = Array.isArray(scenarioReport.failures)
    ? scenarioReport.failures
    : [];
  const failureCodes = failures
    .map((failure) =>
      failure && typeof failure === "object"
        ? String((failure as Record<string, unknown>).code ?? "unknown_failure")
        : "unknown_failure"
    )
    .filter(Boolean);
  const finalSnapshot =
    scenarioReport.finalSnapshot && typeof scenarioReport.finalSnapshot === "object"
      ? (scenarioReport.finalSnapshot as Record<string, unknown>)
      : null;
  const session =
    finalSnapshot?.session && typeof finalSnapshot.session === "object"
      ? (finalSnapshot.session as Record<string, unknown>)
      : null;
  const sessionId =
    typeof session?.id === "string"
      ? session.id
      : null;

  return {
    scenarioId,
    passed: Boolean(scenarioReport.passed),
    failureCodes,
    sessionId,
    reportPath,
    metrics: sessionId ? await loadScenarioMetrics(sessionId) : null,
  };
}

async function main() {
  const label = process.argv[2]?.trim() || "benchmark";
  const scenarios =
    process.argv.slice(3).filter(Boolean).length > 0
      ? process.argv.slice(3).filter(Boolean)
      : [...DEFAULT_BENCHMARK_SCENARIOS];
  const results: ScenarioBenchmarkResult[] = [];

  for (const scenarioId of scenarios) {
    results.push(await benchmarkScenario(scenarioId));
  }

  const totalPlannerCalls = results.reduce(
    (sum, item) => sum + (item.metrics?.plannerCalls ?? 0),
    0
  );
  const totalPromptTokens = results.reduce(
    (sum, item) => sum + (item.metrics?.promptTokens ?? 0),
    0
  );
  const totalPlannerDurationMs = results.reduce(
    (sum, item) => sum + (item.metrics?.plannerDurationMs ?? 0),
    0
  );

  const summary = {
    label,
    baseUrl: BASE_URL,
    scenarios,
    scenarioCount: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    totalPlannerCalls,
    totalPromptTokens,
    totalTokens: results.reduce(
      (sum, item) => sum + (item.metrics?.totalTokens ?? 0),
      0
    ),
    totalPlannerDurationMs,
    totalRateLimitErrors: results.reduce(
      (sum, item) => sum + (item.metrics?.rateLimitErrors ?? 0),
      0
    ),
    averagePlannerPromptTokens: Math.round(
      totalPromptTokens / Math.max(1, totalPlannerCalls)
    ),
    averagePlannerDurationMs: Math.round(
      totalPlannerDurationMs / Math.max(1, totalPlannerCalls)
    ),
    results,
  };

  const outputPath = `/tmp/${label}-benchmark.json`;
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nBENCHMARK_SUMMARY ${outputPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
