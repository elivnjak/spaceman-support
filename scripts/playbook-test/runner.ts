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

const TURN_TIMEOUT_MS = Number(process.env.PLAYBOOK_TEST_TURN_TIMEOUT_MS ?? 120_000);
type RequestPayload = NonNullable<TurnResponsePayload["requests"]>[number];

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

function normalizeAnswerToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapNumericValueToEnumOption(
  numericValue: number,
  options: string[]
): string | null {
  for (const option of options) {
    const normalized = normalizeAnswerToken(option);
    const lessThan = normalized.match(/^less than (\d+(?:\.\d+)?) months?(?: ago)?$/);
    if (lessThan && numericValue < Number(lessThan[1])) {
      return option;
    }

    const moreThan = normalized.match(/^(?:more than|over) (\d+(?:\.\d+)?) months?(?: ago)?$/);
    if (moreThan && numericValue > Number(moreThan[1])) {
      return option;
    }

    const between = normalized.match(
      /^(\d+(?:\.\d+)?) (?:to|-) (\d+(?:\.\d+)?) months?(?: ago)?$/
    );
    if (
      between &&
      numericValue >= Number(between[1]) &&
      numericValue <= Number(between[2])
    ) {
      return option;
    }
  }

  return null;
}

export function coerceAutoAnswerForRequest(
  user: string,
  request?: RequestPayload
): string {
  const trimmed = user.trim();
  if (!request?.expectedInput) return trimmed;

  const expectedInput = request.expectedInput;
  const options = expectedInput.options ?? [];
  if (options.length > 0) {
    const numericMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (numericMatch) {
      const numericOption = mapNumericValueToEnumOption(Number(numericMatch[0]), options);
      if (numericOption) return numericOption;
    }

    const normalized = normalizeAnswerToken(trimmed);
    const exact = options.find((option: string) => normalizeAnswerToken(option) === normalized);
    if (exact) return exact;

    const loose = options.find((option: string) => {
      const normalizedOption = normalizeAnswerToken(option);
      return normalizedOption.includes(normalized) || normalized.includes(normalizedOption);
    });
    if (loose) return loose;

    throw new Error(
      `Auto-answer "${trimmed}" does not match allowed options for request ${request.id}: ${options.join(", ")}`
    );
  }

  const inputType = expectedInput.type?.toLowerCase();
  if (inputType === "boolean") {
    const normalized = normalizeAnswerToken(trimmed);
    if (["yes", "y", "true"].includes(normalized)) return "Yes";
    if (["no", "n", "false"].includes(normalized)) return "No";
    throw new Error(
      `Auto-answer "${trimmed}" is not a valid boolean answer for request ${request.id}`
    );
  }

  if (inputType === "number") {
    const match = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      throw new Error(
        `Auto-answer "${trimmed}" is not a valid numeric answer for request ${request.id}`
      );
    }
    return match[0];
  }

  return trimmed;
}

function resolveAutoAnswer(options: {
  loadedScenario: LoadedScenario;
  scenario: LoadedScenario["scenario"];
  previousResponse: TurnResponsePayload | null;
}) {
  const requestIds = options.previousResponse?.requests?.map((request) => request.id) ?? [];
  const requestId = requestIds.find((candidate) => candidate in (options.scenario.autoResponse?.answers ?? {}));
  const request =
    options.previousResponse?.requests?.find((candidate) => candidate.id === requestId) ??
    options.previousResponse?.requests?.[0];
  const answer =
    (requestId ? options.scenario.autoResponse?.answers[requestId] : undefined) ??
    options.scenario.autoResponse?.defaultAnswer;

  if (!answer) {
    throw new Error(
      `Scenario ${options.scenario.id} could not auto-answer request IDs: ${
        requestIds.join(", ") || "(none)"
      }`
    );
  }

  return {
    ...answer,
    user: coerceAutoAnswerForRequest(answer.user, request),
  };
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
  let lastResponsePayload: TurnResponsePayload | null = null;

  for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
    const turn = scenario.turns[turnIndex]!;
    if (
      turn.autoRespond &&
      lastResponsePayload &&
      ["resolving", "resolved_followup", "escalated"].includes(lastResponsePayload.phase)
    ) {
      break;
    }

    const autoAnswer = turn.autoRespond
      ? resolveAutoAnswer({
          loadedScenario: options.loadedScenario,
          scenario,
          previousResponse: lastResponsePayload,
        })
      : null;
    const formData = new FormData();
    formData.set("message", autoAnswer?.user ?? turn.user);
    if (autoAnswer?.inputSource ?? turn.inputSource) {
      formData.set("inputSource", autoAnswer?.inputSource ?? turn.inputSource!);
    }

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

    for (const absolutePath of resolveScenarioFixtures(options.loadedScenario, autoAnswer?.images ?? turn.images)) {
      await appendImageToForm(formData, absolutePath, path.basename(absolutePath));
    }

    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "x-playbook-test-mode": "true",
        },
        body: formData,
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(
          `Scenario ${scenario.id} turn ${turnIndex + 1} timed out after ${TURN_TIMEOUT_MS}ms`
        );
      }
      throw error;
    }
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
    lastResponsePayload = payload;
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

  const finalEvaluation = gradeFinalExpectation(
    scenario.finalExpect,
    finalSnapshot,
    lastResponsePayload
  );
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
