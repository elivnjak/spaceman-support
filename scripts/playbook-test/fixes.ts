import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { buildPlaybookWorkbookBuffer, savePlaybookWorkbookPayload } from "@/lib/playbooks/workbook";
import { intentManifest } from "@/lib/db/schema";
import type { IntentManifestOverride } from "@/lib/intent/types";
import type { PlaybookWorkbookPayload } from "@/lib/playbooks/workbook";
import type { LoadedScenario, PlaybookTestScenario } from "./schema";
import type { ScenarioRunResult } from "./runner";
import type { FileEdit, SandboxDatabase } from "./sandbox";
import {
  applySearchReplaceEdits,
  cleanupWorkspaceSandbox,
  createWorkspaceSandbox,
  readRelevantFileSnippets,
  startAppInstance,
} from "./sandbox";

export type FixLayer =
  | "scenario"
  | "playbook"
  | "prompt_config_business_logic"
  | "application_code";

export type FixCandidate = {
  id: string;
  title: string;
  layer: FixLayer;
  rationale: string;
  scenarioUpdates?: Array<{
    scenarioId: string;
    scenario: PlaybookTestScenario;
  }>;
  playbookUpdates?: Array<{
    playbookId?: string;
    payload: PlaybookWorkbookPayload;
  }>;
  intentManifestPatch?: IntentManifestOverride;
  fileEdits?: FileEdit[];
  validation?: CandidateValidationResult;
};

export type CandidateValidationResult = {
  accepted: boolean;
  fixedScenarioIds: string[];
  regressedScenarioIds: string[];
  passRate: number;
  totalPassed: number;
  totalScenarios: number;
};

export function classifyFailureLayer(result: ScenarioRunResult): FixLayer {
  const codes = new Set(result.failures.map((failure) => failure.code));
  if (
    codes.has("audit_errors_present") ||
    codes.has("sanitization_errors_present")
  ) {
    return "application_code";
  }
  if (
    codes.has("playbook_label_mismatch") ||
    codes.has("final_playbook_label_mismatch") ||
    codes.has("phase_mismatch") ||
    codes.has("outcome_mismatch")
  ) {
    return "prompt_config_business_logic";
  }
  if (
    codes.has("requested_ids_mismatch") ||
    codes.has("extracted_evidence_mismatch") ||
    codes.has("cause_mismatch") ||
    codes.has("resolution_step_ids_mismatch") ||
    codes.has("final_cause_mismatch")
  ) {
    return "playbook";
  }
  return "scenario";
}

function cloneScenarioUpdate(result: ScenarioRunResult, loadedScenario: LoadedScenario): FixCandidate {
  const scenario = structuredClone(loadedScenario.scenario);
  const finalSnapshot = result.finalSnapshot;
  if (!finalSnapshot) {
    throw new Error(`Cannot build scenario update for ${result.scenarioId} without a final snapshot`);
  }

  scenario.finalExpect = {
    status: finalSnapshot.session.status,
    phase: finalSnapshot.session.phase,
    playbookLabel: finalSnapshot.playbookLabel ?? loadedScenario.scenario.finalExpect.playbookLabel,
    ...(finalSnapshot.session.resolvedCauseId
      ? { causeId: finalSnapshot.session.resolvedCauseId }
      : {}),
    maxTurns: finalSnapshot.session.turnCount ?? loadedScenario.scenario.turns.length,
  };

  scenario.turns = scenario.turns.map((turn, index) => {
    const actualTurn = result.turnResults[index];
    if (!actualTurn) return turn;
    return {
      ...turn,
      expect: {
        phase: actualTurn.response.phase,
        requestedIds: actualTurn.response.requests?.map((request) => request.id) ?? [],
        extractedEvidenceIds: Object.keys(
          (actualTurn.snapshot.session.evidence as Record<string, unknown>) ?? {}
        ),
        playbookLabel: actualTurn.snapshot.playbookLabel ?? undefined,
        ...(actualTurn.response.resolution?.causeId
          ? { causeId: actualTurn.response.resolution.causeId }
          : {}),
        ...(actualTurn.response.resolution?.steps
          ? {
              resolutionStepIds: actualTurn.response.resolution.steps.map(
                (step) => step.step_id
              ),
            }
          : {}),
      },
    };
  });

  return {
    id: `scenario-${result.scenarioId}`,
    title: `Update scenario expectations for ${result.scenarioId}`,
    layer: "scenario",
    rationale:
      "The observed workflow was internally consistent, so this candidate updates scenario expectations to match the current behavior.",
    scenarioUpdates: [
      {
        scenarioId: loadedScenario.scenario.id,
        scenario,
      },
    ],
  };
}

function buildHeuristicCandidates(
  failingResults: ScenarioRunResult[],
  loadedScenarios: LoadedScenario[]
): FixCandidate[] {
  const candidates: FixCandidate[] = [];
  for (const result of failingResults) {
    const loadedScenario = loadedScenarios.find(
      (candidate) => candidate.scenario.id === result.scenarioId
    );
    if (!loadedScenario) continue;
    if (classifyFailureLayer(result) === "scenario") {
      candidates.push(cloneScenarioUpdate(result, loadedScenario));
    }
  }
  return candidates;
}

function buildRelevantFiles(failingResults: ScenarioRunResult[]): string[] {
  const layers = new Set(failingResults.map(classifyFailureLayer));
  const files = new Set<string>();
  if (layers.has("prompt_config_business_logic")) {
    files.add("src/lib/pipeline/playbook-triage.ts");
    files.add("src/lib/pipeline/diagnostic-planner.ts");
    files.add("src/app/api/chat/route.ts");
    files.add("src/lib/config.ts");
    files.add("src/lib/intent/defaults.ts");
  }
  if (layers.has("application_code")) {
    files.add("src/app/api/chat/route.ts");
    files.add("src/lib/pipeline/validate-grounding.ts");
    files.add("src/lib/audit.ts");
  }
  if (layers.has("playbook")) {
    files.add("src/lib/pipeline/diagnostic-planner.ts");
    files.add("src/app/api/chat/route.ts");
  }
  return [...files];
}

function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: key });
}

export async function generateFixCandidates(options: {
  repoRoot: string;
  loadedScenarios: LoadedScenario[];
  suiteResults: ScenarioRunResult[];
  maxFixOptions: number;
}): Promise<FixCandidate[]> {
  const failingResults = options.suiteResults.filter((result) => !result.passed);
  if (failingResults.length === 0) return [];

  const heuristicCandidates = buildHeuristicCandidates(failingResults, options.loadedScenarios);
  let aiCandidates: FixCandidate[] = [];

  try {
    const relevantFiles = buildRelevantFiles(failingResults);
    const snippets = await readRelevantFileSnippets(options.repoRoot, relevantFiles);
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You generate ranked draft fix candidates for a diagnostic support application. Return JSON only. Prefer the smallest safe change that generalizes across the whole test suite. Do not mutate production data. Allowed outputs: scenarioUpdates, playbookUpdates, intentManifestPatch, fileEdits (search/replace edits).",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              maxFixOptions: options.maxFixOptions,
              failingScenarios: failingResults.map((result) => ({
                scenarioId: result.scenarioId,
                failures: result.failures,
                finalSnapshot: result.finalSnapshot
                  ? {
                      status: result.finalSnapshot.session.status,
                      phase: result.finalSnapshot.session.phase,
                      playbookLabel: result.finalSnapshot.playbookLabel,
                      resolvedCauseId: result.finalSnapshot.session.resolvedCauseId,
                    }
                  : null,
                turnResults: result.turnResults.map((turnResult) => ({
                  turnIndex: turnResult.turnIndex,
                  response: {
                    phase: turnResult.response.phase,
                    requests: turnResult.response.requests,
                    causeId: turnResult.response.resolution?.causeId,
                    stepIds:
                      turnResult.response.resolution?.steps?.map((step) => step.step_id) ?? [],
                  },
                  failures: turnResult.failures,
                })),
              })),
              scenarios: options.loadedScenarios.map((item) => item.scenario),
              relevantFiles: snippets,
              outputSchema: {
                candidates: [
                  {
                    id: "string",
                    title: "string",
                    layer:
                      "scenario | playbook | prompt_config_business_logic | application_code",
                    rationale: "string",
                    scenarioUpdates: [
                      {
                        scenarioId: "string",
                        scenario: "full scenario object",
                      },
                    ],
                    playbookUpdates: [
                      {
                        playbookId: "string | undefined",
                        payload: "full PlaybookWorkbookPayload object",
                      },
                    ],
                    intentManifestPatch: "partial manifest override object",
                    fileEdits: [
                      {
                        filePath: "relative path",
                        search: "exact existing string",
                        replace: "replacement string",
                      },
                    ],
                  },
                ],
              },
            },
            null,
            2
          ),
        },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (raw) {
      const parsed = JSON.parse(raw) as { candidates?: FixCandidate[] };
      aiCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    }
  } catch {
    aiCandidates = [];
  }

  const deduped = new Map<string, FixCandidate>();
  for (const candidate of [...heuristicCandidates, ...aiCandidates]) {
    if (!candidate.id) continue;
    if (!deduped.has(candidate.id)) {
      deduped.set(candidate.id, candidate);
    }
  }

  return [...deduped.values()].slice(0, options.maxFixOptions);
}

export function scoreCandidateValidation(
  baseResults: ScenarioRunResult[],
  candidateResults: ScenarioRunResult[]
): CandidateValidationResult {
  const basePassed = new Set(
    baseResults.filter((result) => result.passed).map((result) => result.scenarioId)
  );
  const candidatePassed = new Set(
    candidateResults.filter((result) => result.passed).map((result) => result.scenarioId)
  );
  const fixedScenarioIds = baseResults
    .filter((result) => !result.passed && candidatePassed.has(result.scenarioId))
    .map((result) => result.scenarioId);
  const regressedScenarioIds = [...basePassed].filter((scenarioId) => !candidatePassed.has(scenarioId));
  const totalPassed = candidateResults.filter((result) => result.passed).length;

  return {
    accepted: fixedScenarioIds.length > 0 && regressedScenarioIds.length === 0,
    fixedScenarioIds,
    regressedScenarioIds,
    passRate: candidateResults.length > 0 ? totalPassed / candidateResults.length : 0,
    totalPassed,
    totalScenarios: candidateResults.length,
  };
}

export async function persistCandidateArtifacts(options: {
  reportDir: string;
  candidate: FixCandidate;
  sandboxDb: SandboxDatabase;
}) {
  const candidateDir = path.join(options.reportDir, "candidates", options.candidate.id);
  await mkdir(candidateDir, { recursive: true });
  await writeFile(
    path.join(candidateDir, "candidate.json"),
    JSON.stringify(options.candidate, null, 2),
    "utf-8"
  );

  if (options.candidate.scenarioUpdates) {
    for (const update of options.candidate.scenarioUpdates) {
      await writeFile(
        path.join(candidateDir, `${update.scenarioId}.scenario.json`),
        JSON.stringify(update.scenario, null, 2),
        "utf-8"
      );
    }
  }

  if (options.candidate.playbookUpdates) {
    for (const update of options.candidate.playbookUpdates) {
      const saved = await savePlaybookWorkbookPayload(update.payload, options.sandboxDb);
      const exported = await buildPlaybookWorkbookBuffer(saved.id, options.sandboxDb);
      await writeFile(path.join(candidateDir, exported.fileName), exported.buffer);
    }
  }
}

export async function applyCandidateToSandbox(options: {
  repoRoot: string;
  workspaceDir?: string;
  sandboxDb: SandboxDatabase;
  candidate: FixCandidate;
  schema: string;
  storagePath: string;
}): Promise<{ baseUrl: string; stop: () => Promise<void>; workspaceDir: string | null }> {
  const workspaceDir = options.candidate.fileEdits?.length
    ? await createWorkspaceSandbox(options.repoRoot)
    : null;
  const effectiveWorkspaceDir = workspaceDir ?? options.repoRoot;

  if (options.candidate.fileEdits?.length) {
    await applySearchReplaceEdits(effectiveWorkspaceDir, options.candidate.fileEdits);
  }

  if (options.candidate.intentManifestPatch) {
    const [existingRow] = await options.sandboxDb
      .select({ data: intentManifest.data })
      .from(intentManifest)
      .where(eq(intentManifest.id, "default"))
      .limit(1);
    const nextData = {
      ...(typeof existingRow?.data === "object" && existingRow?.data ? existingRow.data : {}),
      ...options.candidate.intentManifestPatch,
    };
    if (existingRow) {
      await options.sandboxDb
        .update(intentManifest)
        .set({ data: nextData, updatedAt: new Date() })
        .where(eq(intentManifest.id, "default"));
    } else {
      await options.sandboxDb.insert(intentManifest).values({
        id: "default",
        data: nextData,
      });
    }
  }

  if (options.candidate.playbookUpdates) {
    for (const update of options.candidate.playbookUpdates) {
      await savePlaybookWorkbookPayload(update.payload, options.sandboxDb);
    }
  }

  const app = await startAppInstance({
    workspaceDir: effectiveWorkspaceDir,
    schema: options.schema,
    storagePath: options.storagePath,
  });

  return {
    baseUrl: app.baseUrl,
    stop: async () => {
      await app.stop();
      if (workspaceDir) {
        await cleanupWorkspaceSandbox(workspaceDir);
      }
    },
    workspaceDir,
  };
}
