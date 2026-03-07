import { access, readdir, readFile } from "fs/promises";
import path from "path";
import { z } from "zod";

const turnExpectationSchema = z
  .object({
    phase: z.string().min(1).optional(),
    requestedIds: z.array(z.string().min(1)).optional(),
    forbiddenRequestIds: z.array(z.string().min(1)).optional(),
    extractedEvidenceIds: z.array(z.string().min(1)).optional(),
    playbookLabel: z.string().min(1).optional(),
    causeId: z.string().min(1).optional(),
    outcome: z.enum(["resolved", "escalated"]).optional(),
    resolutionStepIds: z.array(z.string().min(1)).optional(),
    escalationReasonIncludes: z.string().min(1).optional(),
  })
  .strict();

const finalExpectationSchema = z
  .object({
    status: z.string().min(1),
    phase: z.string().min(1),
    playbookLabel: z.string().min(1),
    causeId: z.string().min(1).optional(),
    maxTurns: z.number().int().positive().optional(),
  })
  .strict();

export const playbookTestScenarioSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    suite: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    initialContext: z
      .object({
        machineModel: z.string().min(1).optional(),
        productType: z.string().min(1).optional(),
        serialNumber: z.string().min(1).optional(),
      })
      .default({}),
    turns: z
      .array(
        z
          .object({
            user: z.string().min(1),
            images: z.array(z.string().min(1)).default([]),
            expect: turnExpectationSchema.default({}),
          })
          .strict()
      )
      .min(1),
    finalExpect: finalExpectationSchema,
  })
  .strict();

export type PlaybookTestScenario = z.infer<typeof playbookTestScenarioSchema>;
export type PlaybookTestTurnExpectation = z.infer<typeof turnExpectationSchema>;
export type PlaybookTestFinalExpectation = z.infer<typeof finalExpectationSchema>;

export type LoadedScenario = {
  scenario: PlaybookTestScenario;
  scenarioPath: string;
  scenarioDir: string;
};

export async function loadScenarioFile(scenarioPath: string): Promise<LoadedScenario> {
  const raw = await readFile(scenarioPath, "utf-8");
  const parsed = playbookTestScenarioSchema.parse(JSON.parse(raw));
  const scenarioDir = path.dirname(scenarioPath);

  for (const turn of parsed.turns) {
    for (const imagePath of turn.images) {
      const resolved = path.join(scenarioDir, "fixtures", imagePath);
      try {
        await access(resolved);
      } catch {
        throw new Error(
          `Scenario ${parsed.id} references missing fixture "${imagePath}" at ${resolved}`
        );
      }
    }
  }

  return {
    scenario: parsed,
    scenarioPath,
    scenarioDir,
  };
}

export async function loadScenarioSuite(rootDir: string): Promise<LoadedScenario[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const scenarios: LoadedScenario[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const scenarioPath = path.join(rootDir, entry.name, "scenario.json");
    try {
      await access(scenarioPath);
    } catch {
      continue;
    }
    scenarios.push(await loadScenarioFile(scenarioPath));
  }

  return scenarios.sort((left, right) => left.scenario.id.localeCompare(right.scenario.id));
}

export function resolveScenarioFixtures(loaded: LoadedScenario, relativePaths: string[]): string[] {
  return relativePaths.map((relativePath) =>
    path.join(loaded.scenarioDir, "fixtures", relativePath)
  );
}
