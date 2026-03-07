import type { AuditLog, DiagnosticSession, Playbook } from "@/lib/db/schema";
import type {
  PlaybookTestFinalExpectation,
  PlaybookTestTurnExpectation,
} from "./schema";

export type TurnResponsePayload = {
  sessionId: string;
  sessionToken?: string;
  message: string;
  phase: string;
  requests?: { id: string; type: string }[];
  resolution?: {
    causeId?: string;
    steps?: { step_id: string }[];
  };
  escalation_reason?: string;
};

export type SessionSnapshot = {
  session: DiagnosticSession;
  playbookLabel: string | null;
  playbook: Playbook | null;
  auditLog: AuditLog | null;
};

export type ScenarioFailure = {
  code: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type TurnEvaluation = {
  failures: ScenarioFailure[];
  passed: boolean;
};

export function inferOutcome(payload: TurnResponsePayload): "resolved" | "escalated" | null {
  if (payload.phase === "resolving" || payload.phase === "resolved_followup") {
    return "resolved";
  }
  if (payload.phase === "escalated") {
    return "escalated";
  }
  return null;
}

function compareSet(
  code: string,
  label: string,
  expected: string[] | undefined,
  actual: string[]
): ScenarioFailure[] {
  if (!expected) return [];
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  if (JSON.stringify(expectedSorted) === JSON.stringify(actualSorted)) return [];
  return [
    {
      code,
      message: `${label} mismatch`,
      expected: expectedSorted,
      actual: actualSorted,
    },
  ];
}

export function gradeTurnExpectation(
  expectation: PlaybookTestTurnExpectation,
  payload: TurnResponsePayload,
  snapshot: SessionSnapshot
): TurnEvaluation {
  const failures: ScenarioFailure[] = [];
  const requestIds = (payload.requests ?? []).map((request) => request.id);
  const auditPayload = (snapshot.auditLog?.payload as Record<string, unknown> | null) ?? null;
  const extractedEvidenceIds = Array.isArray(
    (auditPayload?.sanitizedOutput as { evidence_extracted?: unknown[] } | undefined)
      ?.evidence_extracted
  )
    ? (
        (auditPayload?.sanitizedOutput as {
          evidence_extracted?: Array<{ evidenceId?: unknown }>;
        }).evidence_extracted ?? []
      )
        .map((item) => item.evidenceId)
        .filter((item): item is string => typeof item === "string")
    : [];
  const resolutionStepIds = payload.resolution?.steps?.map((step) => step.step_id) ?? [];
  const outcome = inferOutcome(payload);
  const causeId = payload.resolution?.causeId ?? snapshot.session.resolvedCauseId ?? null;

  if (expectation.phase && payload.phase !== expectation.phase) {
    failures.push({
      code: "phase_mismatch",
      message: "Phase mismatch",
      expected: expectation.phase,
      actual: payload.phase,
    });
  }

  failures.push(...compareSet("requested_ids_mismatch", "Requested IDs", expectation.requestedIds, requestIds));
  failures.push(
    ...compareSet(
      "extracted_evidence_mismatch",
      "Extracted evidence IDs",
      expectation.extractedEvidenceIds,
      extractedEvidenceIds
    )
  );
  failures.push(
    ...compareSet(
      "resolution_step_ids_mismatch",
      "Resolution step IDs",
      expectation.resolutionStepIds,
      resolutionStepIds
    )
  );

  if (expectation.forbiddenRequestIds) {
    const forbiddenSeen = expectation.forbiddenRequestIds.filter((item) => requestIds.includes(item));
    if (forbiddenSeen.length > 0) {
      failures.push({
        code: "forbidden_request_seen",
        message: "Forbidden request IDs were returned",
        expected: expectation.forbiddenRequestIds,
        actual: forbiddenSeen,
      });
    }
  }

  if (expectation.playbookLabel && snapshot.playbookLabel !== expectation.playbookLabel) {
    failures.push({
      code: "playbook_label_mismatch",
      message: "Playbook label mismatch",
      expected: expectation.playbookLabel,
      actual: snapshot.playbookLabel,
    });
  }

  if (expectation.causeId && causeId !== expectation.causeId) {
    failures.push({
      code: "cause_mismatch",
      message: "Cause mismatch",
      expected: expectation.causeId,
      actual: causeId,
    });
  }

  if (expectation.outcome && outcome !== expectation.outcome) {
    failures.push({
      code: "outcome_mismatch",
      message: "Outcome mismatch",
      expected: expectation.outcome,
      actual: outcome,
    });
  }

  if (
    expectation.escalationReasonIncludes &&
    !String(payload.escalation_reason ?? "").includes(expectation.escalationReasonIncludes)
  ) {
    failures.push({
      code: "escalation_reason_mismatch",
      message: "Escalation reason mismatch",
      expected: expectation.escalationReasonIncludes,
      actual: payload.escalation_reason ?? null,
    });
  }

  return {
    failures,
    passed: failures.length === 0,
  };
}

export function gradeFinalExpectation(
  expectation: PlaybookTestFinalExpectation,
  snapshot: SessionSnapshot
): TurnEvaluation {
  const failures: ScenarioFailure[] = [];
  if (snapshot.session.status !== expectation.status) {
    failures.push({
      code: "final_status_mismatch",
      message: "Final status mismatch",
      expected: expectation.status,
      actual: snapshot.session.status,
    });
  }
  if (snapshot.session.phase !== expectation.phase) {
    failures.push({
      code: "final_phase_mismatch",
      message: "Final phase mismatch",
      expected: expectation.phase,
      actual: snapshot.session.phase,
    });
  }
  if (snapshot.playbookLabel !== expectation.playbookLabel) {
    failures.push({
      code: "final_playbook_label_mismatch",
      message: "Final playbook label mismatch",
      expected: expectation.playbookLabel,
      actual: snapshot.playbookLabel,
    });
  }
  if (expectation.causeId && snapshot.session.resolvedCauseId !== expectation.causeId) {
    failures.push({
      code: "final_cause_mismatch",
      message: "Final cause mismatch",
      expected: expectation.causeId,
      actual: snapshot.session.resolvedCauseId,
    });
  }
  if (
    expectation.maxTurns !== undefined &&
    (snapshot.session.turnCount ?? 0) > expectation.maxTurns
  ) {
    failures.push({
      code: "final_turn_cap_exceeded",
      message: "Final turn count exceeded",
      expected: expectation.maxTurns,
      actual: snapshot.session.turnCount,
    });
  }
  return {
    failures,
    passed: failures.length === 0,
  };
}

export function summarizeAuditIssues(snapshot: SessionSnapshot): ScenarioFailure[] {
  const payload = (snapshot.auditLog?.payload as Record<string, unknown> | null) ?? null;
  if (!payload) return [];

  const failures: ScenarioFailure[] = [];
  const sanitizationErrors = Array.isArray(payload.sanitizationErrors)
    ? payload.sanitizationErrors.filter((item): item is string => typeof item === "string")
    : [];
  if (sanitizationErrors.length > 0) {
    failures.push({
      code: "sanitization_errors_present",
      message: "Planner sanitization errors were recorded",
      actual: sanitizationErrors,
    });
  }

  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((item): item is string => typeof item === "string")
    : [];
  if (errors.length > 0) {
    failures.push({
      code: "audit_errors_present",
      message: "Audit errors were recorded",
      actual: errors,
    });
  }

  return failures;
}
