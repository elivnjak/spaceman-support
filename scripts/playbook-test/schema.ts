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
    handoffLabelId: z.string().min(1).optional(),
    causeId: z.string().min(1).optional(),
    outcome: z.enum(["resolved", "escalated"]).optional(),
    resolutionStepIds: z.array(z.string().min(1)).optional(),
    escalationReasonIncludes: z.string().min(1).optional(),
  })
  .strict();

const turnInputSourceSchema = z.enum(["chat", "structured", "skip", "note"]);

const autoResponseAnswerSchema = z
  .object({
    user: z.string().min(1),
    inputSource: turnInputSourceSchema.optional(),
    images: z.array(z.string().min(1)).default([]),
    imageLabel: z.string().min(1).optional(),
  })
  .strict();

const finalExpectationSchema = z
  .object({
    status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    playbookLabel: z.string().min(1).optional(),
    handoffLabelId: z.string().min(1).optional(),
    causeId: z.string().min(1).optional(),
    resolutionStepIds: z.array(z.string().min(1)).optional(),
    minResolutionSteps: z.number().int().positive().optional(),
    maxTurns: z.number().int().positive().optional(),
  })
  .strict();

export const playbookTestScenarioSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    suite: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
    autoResponse: z
      .object({
        targetCauseId: z.string().min(1).optional(),
        answers: z.record(z.string().min(1), autoResponseAnswerSchema).default({}),
        defaultAnswer: autoResponseAnswerSchema.optional(),
      })
      .strict()
      .optional(),
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
            inputSource: turnInputSourceSchema.optional(),
            autoRespond: z.boolean().optional(),
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

  const fixtureReferences = [
    ...parsed.turns.flatMap((turn) => turn.images),
    ...Object.values(parsed.autoResponse?.answers ?? {}).flatMap((answer) => answer.images),
    ...(parsed.autoResponse?.defaultAnswer?.images ?? []),
  ];

  for (const imagePath of fixtureReferences) {
    const resolved = path.join(scenarioDir, "fixtures", imagePath);
    try {
      await access(resolved);
    } catch {
      throw new Error(
        `Scenario ${parsed.id} references missing fixture "${imagePath}" at ${resolved}`
      );
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
