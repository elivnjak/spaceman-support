import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  createDatabaseClient,
  createSandbox,
  startAppInstance,
} from "./playbook-test/sandbox";
import { loadScenarioSuite, type LoadedScenario } from "./playbook-test/schema";
import { runScenario, type ScenarioRunResult } from "./playbook-test/runner";
import {
  applyCandidateToSandbox,
  type FixCandidate,
  generateFixCandidates,
  persistCandidateArtifacts,
  scoreCandidateValidation,
} from "./playbook-test/fixes";
import { writeSuiteReports } from "./playbook-test/report";

type CliOptions = {
  suite?: string;
  scenario?: string;
  fix: boolean;
  keepSandbox: boolean;
  reportDir?: string;
  maxFixOptions: number;
  baseUrl?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fix: false,
    keepSandbox: false,
    maxFixOptions: 3,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fix") {
      options.fix = true;
      continue;
    }
    if (arg === "--keep-sandbox") {
      options.keepSandbox = true;
      continue;
    }
    if (arg === "--suite") {
      options.suite = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--scenario") {
      options.scenario = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--report-dir") {
      options.reportDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--max-fix-options") {
      options.maxFixOptions = Number(argv[index + 1] ?? options.maxFixOptions) || options.maxFixOptions;
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function buildRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function filterScenarios(loadedScenarios: LoadedScenario[], options: CliOptions) {
  return loadedScenarios.filter((item) => {
    if (options.scenario && item.scenario.id !== options.scenario) return false;
    if (options.suite && item.scenario.suite !== options.suite) return false;
    return true;
  });
}

async function executeSuiteRun(options: {
  repoRoot: string;
  loadedScenarios: LoadedScenario[];
  scenarioOverrides?: Map<string, LoadedScenario["scenario"]>;
  reportDir?: string;
  keepSandbox?: boolean;
  baseUrl?: string;
}): Promise<{
  results: ScenarioRunResult[];
  schema: string;
  storagePath: string;
}> {
  if (options.baseUrl) {
    const liveDb = createDatabaseClient();
    try {
      const results: ScenarioRunResult[] = [];
      for (const loadedScenario of options.loadedScenarios) {
        results.push(
          await runScenario({
            loadedScenario,
            baseUrl: options.baseUrl,
            db: liveDb.db,
            scenarioOverride: options.scenarioOverrides?.get(loadedScenario.scenario.id),
          })
        );
      }
      return {
        results,
        schema: "live",
        storagePath: "live",
      };
    } finally {
      await liveDb.close();
    }
  }

  const sandbox = await createSandbox();
  let app: Awaited<ReturnType<typeof startAppInstance>> | null = null;
  try {
    app = await startAppInstance({
      workspaceDir: options.repoRoot,
      schema: sandbox.schema,
      storagePath: sandbox.storagePath,
    });
    const results: ScenarioRunResult[] = [];
    for (const loadedScenario of options.loadedScenarios) {
      results.push(
        await runScenario({
          loadedScenario,
          baseUrl: app.baseUrl,
          db: sandbox.db,
          scenarioOverride: options.scenarioOverrides?.get(loadedScenario.scenario.id),
        })
      );
    }
    return {
      results,
      schema: sandbox.schema,
      storagePath: sandbox.storagePath,
    };
  } finally {
    if (app) {
      await app.stop().catch(() => {});
    }
    if (!options.keepSandbox) {
      await sandbox.cleanup().catch(() => {});
    }
  }
}

async function main() {
  const repoRoot = process.cwd();
  const cliOptions = parseArgs(process.argv.slice(2));
  const runId = buildRunId();
  const reportDir =
    cliOptions.reportDir ??
    path.join(repoRoot, "logs", "playbook-tests", runId);
  await mkdir(reportDir, { recursive: true });

  const allScenarios = await loadScenarioSuite(path.join(repoRoot, "data", "playbook_tests"));
  const selectedScenarios = filterScenarios(allScenarios, cliOptions);
  if (selectedScenarios.length === 0) {
    throw new Error("No playbook test scenarios matched the provided filters.");
  }

  const baseRun = await executeSuiteRun({
    repoRoot,
    loadedScenarios: selectedScenarios,
    keepSandbox: cliOptions.keepSandbox,
    baseUrl: cliOptions.baseUrl,
  });
  const summary = {
    runId,
    totalScenarios: baseRun.results.length,
    passedScenarios: baseRun.results.filter((result) => result.passed).length,
    failedScenarios: baseRun.results.filter((result) => !result.passed).length,
    passRate:
      baseRun.results.length > 0
        ? baseRun.results.filter((result) => result.passed).length / baseRun.results.length
        : 0,
  };

  let candidates: FixCandidate[] = [];
  if (cliOptions.fix && summary.failedScenarios > 0) {
    candidates = await generateFixCandidates({
      repoRoot,
      loadedScenarios: selectedScenarios,
      suiteResults: baseRun.results,
      maxFixOptions: cliOptions.maxFixOptions,
    });

    for (const candidate of candidates) {
      const sandbox = await createSandbox();
      let appHandle:
        | Awaited<ReturnType<typeof applyCandidateToSandbox>>
        | null = null;
      try {
        appHandle = await applyCandidateToSandbox({
          repoRoot,
          sandboxDb: sandbox.db,
          candidate,
          schema: sandbox.schema,
          storagePath: sandbox.storagePath,
        });
        const overrideMap = new Map(
          (candidate.scenarioUpdates ?? []).map((update) => [update.scenarioId, update.scenario])
        );
        const candidateResults: ScenarioRunResult[] = [];
        for (const loadedScenario of selectedScenarios) {
          candidateResults.push(
            await runScenario({
              loadedScenario,
              baseUrl: appHandle.baseUrl,
              db: sandbox.db,
              scenarioOverride: overrideMap.get(loadedScenario.scenario.id),
            })
          );
        }
        candidate.validation = scoreCandidateValidation(baseRun.results, candidateResults);
        await persistCandidateArtifacts({
          reportDir,
          candidate,
          sandboxDb: sandbox.db,
        });
        await writeFile(
          path.join(reportDir, "candidates", candidate.id, "results.json"),
          JSON.stringify(candidateResults, null, 2),
          "utf-8"
        );
      } finally {
        if (appHandle) {
          await appHandle.stop().catch(() => {});
        }
        if (!cliOptions.keepSandbox) {
          await sandbox.cleanup().catch(() => {});
        }
      }
    }
  }

  await writeSuiteReports({
    reportDir,
    summary,
    results: baseRun.results,
    candidates,
  });

  console.log(
    `Playbook tests complete. ${summary.passedScenarios}/${summary.totalScenarios} scenarios passed. Report: ${reportDir}`
  );
  if (summary.failedScenarios > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
