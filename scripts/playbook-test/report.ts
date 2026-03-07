import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { FixCandidate } from "./fixes";
import type { ScenarioRunResult } from "./runner";

export type SuiteSummary = {
  runId: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  passRate: number;
};

export async function ensureReportDir(reportDir: string) {
  await mkdir(reportDir, { recursive: true });
  await mkdir(path.join(reportDir, "scenarios"), { recursive: true });
  await mkdir(path.join(reportDir, "candidates"), { recursive: true });
}

export async function writeSuiteReports(options: {
  reportDir: string;
  summary: SuiteSummary;
  results: ScenarioRunResult[];
  candidates: FixCandidate[];
}) {
  await ensureReportDir(options.reportDir);

  await writeFile(
    path.join(options.reportDir, "summary.json"),
    JSON.stringify(
      {
        summary: options.summary,
        results: options.results,
        candidates: options.candidates,
      },
      null,
      2
    ),
    "utf-8"
  );

  const markdown = [
    "# Playbook Test Summary",
    "",
    `- Run ID: \`${options.summary.runId}\``,
    `- Scenarios: ${options.summary.totalScenarios}`,
    `- Passed: ${options.summary.passedScenarios}`,
    `- Failed: ${options.summary.failedScenarios}`,
    `- Pass rate: ${(options.summary.passRate * 100).toFixed(1)}%`,
    "",
    "## Scenarios",
    "",
    ...options.results.flatMap((result) => [
      `### ${result.scenarioId}`,
      "",
      `- Status: ${result.passed ? "passed" : "failed"}`,
      `- Description: ${result.description}`,
      ...(result.failures.length > 0
        ? result.failures.map((failure) => `- ${failure.code}: ${failure.message}`)
        : ["- No failures"]),
      "",
    ]),
    "## Candidates",
    "",
    ...(options.candidates.length > 0
      ? options.candidates.flatMap((candidate) => [
          `### ${candidate.title}`,
          "",
          `- Layer: ${candidate.layer}`,
          `- Rationale: ${candidate.rationale}`,
          ...(candidate.validation
            ? [
                `- Accepted: ${candidate.validation.accepted ? "yes" : "no"}`,
                `- Fixed: ${candidate.validation.fixedScenarioIds.join(", ") || "-"}`,
                `- Regressed: ${candidate.validation.regressedScenarioIds.join(", ") || "-"}`,
                `- Candidate pass rate: ${(candidate.validation.passRate * 100).toFixed(1)}%`,
              ]
            : ["- Validation: not run"]),
          "",
        ])
      : ["No candidates generated.", ""]),
  ].join("\n");

  await writeFile(path.join(options.reportDir, "summary.md"), markdown, "utf-8");

  for (const result of options.results) {
    await writeFile(
      path.join(options.reportDir, "scenarios", `${result.scenarioId}.json`),
      JSON.stringify(result, null, 2),
      "utf-8"
    );
  }
}
