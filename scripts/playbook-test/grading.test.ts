import test from "node:test";
import assert from "node:assert/strict";
import { gradeFinalExpectation, gradeTurnExpectation, summarizeAuditIssues } from "./grading";
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
      handoffLabelId: undefined,
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
      handoffLabelId: undefined,
      causeId: "hopper_too_warm",
      resolutionStepIds: ["cool-hopper"],
      maxTurns: 4,
    },
    buildSnapshot({ turnCount: 5 }),
    {
      sessionId: "session-1",
      message: "Resolved",
      phase: "resolving",
      requests: [],
      resolution: {
        causeId: "hopper_too_warm",
        steps: [{ step_id: "clear-space" }],
      },
    }
  );

  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.failures.some((failure) => failure.code === "final_turn_cap_exceeded"), true);
  assert.equal(
    evaluation.failures.some(
      (failure) => failure.code === "final_resolution_step_ids_mismatch"
    ),
    true
  );
});

test("summarizeAuditIssues ignores benign verifier step-pruning notes", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "Verifier removed redundant or irrelevant resolution steps: step-a, step-b",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores resolving-turn request cleanup", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "Stripped requests from resolving turn: resolution and requests are mutually exclusive",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores all-steps-redundant fallback notes", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "Verifier marked all resolution steps as redundant; keeping authored playbook steps as fallback",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores repeated-request cleanup when the turn already concluded", () => {
  const failures = summarizeAuditIssues({
    session: {} as never,
    playbookLabel: null,
    playbook: null,
    auditLog: {
      payload: {
        sanitizationErrors: [
          "Removed repeated requests for already-collected evidence: read_hopper_temp_display",
        ],
        sanitizedOutput: {
          phase: "escalated",
          requests: [],
        },
      },
    } as never,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores generic request cleanup and fallback insertion notes", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "Removed repeated requests for already-collected evidence: check_product_brix",
          "Inserted fallback request for missing evidence: ev_display_photo",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores canonical extracted-evidence remap notes", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "Remapped extracted evidence confirm_idle_time to canonical checklist ID ev_idle_time",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores supported-structured-cause fallback notes", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "Structured playbook rules fully support cause_air_tube_blocked; switching to fallback resolution",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores verifier rejection notes when runtime switches to structured-supported cause", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "LLM verifier rejected resolution cause cause_autofill_incompatible: unsupported (The proposed cause is excluded by explicit playbook rules for the collected evidence.); switching to structured-supported cause cause_filter_blocked",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues ignores verifier rejection notes when runtime keeps the same structured-supported cause", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: [
          "LLM verifier rejected resolution cause cause_dry_or_damaged_seals: ambiguous (The proposed cause is only partially supported by the playbook's structured evidence rules.); keeping resolution because structured playbook rules uniquely support the same cause",
        ],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.length, 0);
});

test("summarizeAuditIssues still reports actionable sanitization errors", () => {
  const failures = summarizeAuditIssues({
    ...buildSnapshot(),
    auditLog: {
      id: "audit-1",
      sessionId: "session-1",
      turnNumber: 1,
      payload: {
        sanitizationErrors: ["Invalid step_ids: missing-step"],
      },
      createdAt: new Date(),
    } satisfies AuditLog,
  });

  assert.equal(failures.some((failure) => failure.code === "sanitization_errors_present"), true);
});
