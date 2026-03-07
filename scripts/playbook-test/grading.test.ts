import test from "node:test";
import assert from "node:assert/strict";
import { gradeFinalExpectation, gradeTurnExpectation } from "./grading";
import type { DiagnosticSession, Playbook, AuditLog } from "@/lib/db/schema";

function buildSnapshot(overrides?: Partial<DiagnosticSession> & { playbookLabel?: string | null }) {
  const session = {
    id: "session-1",
    status: "resolved",
    ticketStatus: "open",
    userName: null,
    userPhone: null,
    machineModel: "6210",
    serialNumber: null,
    productType: null,
    clearanceImagePaths: [],
    manufacturingYear: null,
    playbookId: "pb-1",
    triageHistory: [],
    triageRound: 0,
    messages: [],
    evidence: {
      machine_model: { value: "6210" },
      hopper_temp: { value: -1 },
    },
    hypotheses: [],
    phase: "resolving",
    turnCount: 4,
    resolvedCauseId: "hopper_too_warm",
    escalationReason: null,
    resolutionOutcome: null,
    verificationRequestedAt: null,
    verificationRespondedAt: null,
    escalationHandoff: null,
    frustrationTurnCount: 0,
    escalationContextTurnCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } satisfies DiagnosticSession;

  return {
    session,
    playbookLabel: overrides?.playbookLabel ?? "too_runny",
    playbook: {
      id: "pb-1",
      labelId: "too_runny",
      title: "Too Runny",
      enabled: true,
      steps: [],
      schemaVersion: 1,
      symptoms: null,
      evidenceChecklist: null,
      candidateCauses: null,
      escalationTriggers: null,
      updatedAt: new Date(),
    } satisfies Playbook,
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizedOutput: {
          evidence_extracted: [
            { evidenceId: "machine_model" },
            { evidenceId: "hopper_temp" },
          ],
        },
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  };
}

test("gradeTurnExpectation validates phase, label, cause, and steps", () => {
  const evaluation = gradeTurnExpectation(
    {
      phase: "resolving",
      playbookLabel: "too_runny",
      causeId: "hopper_too_warm",
      requestedIds: [],
      extractedEvidenceIds: ["hopper_temp", "machine_model"],
      resolutionStepIds: ["step-a"],
      outcome: "resolved",
    },
    {
      sessionId: "session-1",
      message: "Resolved",
      phase: "resolving",
      requests: [],
      resolution: {
        causeId: "hopper_too_warm",
        steps: [{ step_id: "step-a" }],
      },
    },
    buildSnapshot()
  );

  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.failures.length, 0);
});

test("gradeFinalExpectation reports mismatches", () => {
  const evaluation = gradeFinalExpectation(
    {
      status: "resolved",
      phase: "resolving",
      playbookLabel: "too_runny",
      causeId: "hopper_too_warm",
      maxTurns: 4,
    },
    buildSnapshot({ turnCount: 5 })
  );

  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.failures.some((failure) => failure.code === "final_turn_cap_exceeded"), true);
});
