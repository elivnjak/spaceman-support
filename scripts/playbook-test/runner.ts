import { readFile } from "fs/promises";
import path from "path";
import { asc, eq } from "drizzle-orm";
import { auditLogs, diagnosticSessions, playbooks } from "@/lib/db/schema";
import type { SandboxDatabase } from "./sandbox";
import type { LoadedScenario } from "./schema";
import { resolveScenarioFixtures } from "./schema";
import {
  gradeFinalExpectation,
  gradeTurnExpectation,
  summarizeAuditIssues,
  type ScenarioFailure,
  type SessionSnapshot,
  type TurnResponsePayload,
} from "./grading";
import { getLastEventData, parseSsePayload } from "./sse";

export type ScenarioTurnResult = {
  turnIndex: number;
  response: TurnResponsePayload;
  snapshot: SessionSnapshot;
  failures: ScenarioFailure[];
  passed: boolean;
};

export type ScenarioRunResult = {
  scenarioId: string;
  description: string;
  scenarioPath: string;
  passed: boolean;
  failures: ScenarioFailure[];
  turnResults: ScenarioTurnResult[];
  finalSnapshot: SessionSnapshot | null;
};

async function appendImageToForm(
  formData: FormData,
  absolutePath: string,
  fileName: string
): Promise<void> {
  const buffer = await readFile(absolutePath);
  const blob = new Blob([buffer], { type: mimeTypeForFile(fileName) });
  formData.append("images", blob, fileName);
}

function mimeTypeForFile(fileName: string): string {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function fetchSessionSnapshot(
  db: SandboxDatabase,
  sessionId: string
): Promise<SessionSnapshot> {
  const [row] = await db
    .select({
      session: diagnosticSessions,
      playbook: playbooks,
    })
    .from(diagnosticSessions)
    .leftJoin(playbooks, eq(diagnosticSessions.playbookId, playbooks.id))
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);

  if (!row) {
    throw new Error(`Session ${sessionId} not found in sandbox database`);
  }

  const [auditLog] = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.sessionId, sessionId))
    .orderBy(asc(auditLogs.turnNumber), asc(auditLogs.createdAt));

  const latestAuditLog =
    (await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.sessionId, sessionId))
      .orderBy(asc(auditLogs.turnNumber), asc(auditLogs.createdAt)))
      .slice(-1)[0] ?? null;

  void auditLog;

  return {
    session: row.session,
    playbookLabel: row.playbook?.labelId ?? null,
    playbook: row.playbook ?? null,
    auditLog: latestAuditLog,
  };
}

export async function runScenario(options: {
  loadedScenario: LoadedScenario;
  baseUrl: string;
  db: SandboxDatabase;
  scenarioOverride?: LoadedScenario["scenario"];
}): Promise<ScenarioRunResult> {
  const scenario = options.scenarioOverride ?? options.loadedScenario.scenario;
  const turnResults: ScenarioTurnResult[] = [];
  const allFailures: ScenarioFailure[] = [];
  let sessionId: string | null = null;
  let sessionToken: string | null = null;
  let finalSnapshot: SessionSnapshot | null = null;

  for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
    const turn = scenario.turns[turnIndex]!;
    const formData = new FormData();
    formData.set("message", turn.user);

    if (turnIndex === 0) {
      formData.set("userName", "Playbook Test");
      formData.set("userPhone", "0400000000");
      if (scenario.initialContext.machineModel) {
        formData.set("machineModel", scenario.initialContext.machineModel);
      }
    } else if (sessionId) {
      formData.set("sessionId", sessionId);
      if (sessionToken) {
        formData.set("sessionToken", sessionToken);
      }
    }

    for (const absolutePath of resolveScenarioFixtures(options.loadedScenario, turn.images)) {
      await appendImageToForm(formData, absolutePath, path.basename(absolutePath));
    }

    const response = await fetch(`${options.baseUrl}/api/chat`, {
      method: "POST",
      body: formData,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Scenario ${scenario.id} turn ${turnIndex + 1} failed: ${raw}`);
    }

    const events = parseSsePayload(raw);
    const errorEvent = getLastEventData<{ error: string }>(events, "error");
    if (errorEvent?.error) {
      throw new Error(`Scenario ${scenario.id} turn ${turnIndex + 1} error: ${errorEvent.error}`);
    }

    const payload = getLastEventData<TurnResponsePayload>(events, "message");
    if (!payload) {
      throw new Error(`Scenario ${scenario.id} turn ${turnIndex + 1} produced no message event`);
    }
    sessionId = payload.sessionId;
    sessionToken = payload.sessionToken ?? sessionToken;

    const snapshot = await fetchSessionSnapshot(options.db, sessionId);
    finalSnapshot = snapshot;

    const evaluation = gradeTurnExpectation(turn.expect, payload, snapshot);
    const auditFailures = summarizeAuditIssues(snapshot);
    const failures = [...evaluation.failures, ...auditFailures];
    allFailures.push(...failures);

    turnResults.push({
      turnIndex,
      response: payload,
      snapshot,
      failures,
      passed: failures.length === 0,
    });
  }

  if (!finalSnapshot || !sessionId) {
    throw new Error(`Scenario ${scenario.id} did not create a session`);
  }

  const finalEvaluation = gradeFinalExpectation(scenario.finalExpect, finalSnapshot);
  allFailures.push(...finalEvaluation.failures);

  return {
    scenarioId: scenario.id,
    description: scenario.description,
    scenarioPath: options.loadedScenario.scenarioPath,
    passed: allFailures.length === 0,
    failures: allFailures,
    turnResults,
    finalSnapshot,
  };
}
