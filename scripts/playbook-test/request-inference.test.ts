import test from "node:test";
import assert from "node:assert/strict";
import {
  inferEvidenceFromOutstandingRequest,
  mergeInferredEvidenceWithPlannerOutput,
} from "@/lib/pipeline/request-inference";
import type { DiagnosticPlaybook, PlannerRequest } from "@/lib/pipeline/diagnostic-planner";

const playbook: DiagnosticPlaybook = {
  id: "pb-1",
  labelId: "fb_product_leaking_inside_machine",
  title: "Product leaking inside machine",
  steps: [],
  evidenceChecklist: [
    {
      id: "ev_parts_age",
      description: "Tune-up kit/wear parts age (months).",
      type: "confirmation",
      required: false,
    },
    {
      id: "ev_freeze_mode",
      description: "Machine confirmed in FREEZE mode.",
      type: "confirmation",
      required: false,
    },
    {
      id: "ev_reset_attempted",
      description: "RESET button attempted.",
      type: "observation",
      required: false,
    },
  ],
  candidateCauses: [],
  escalationTriggers: [],
  symptoms: [],
};

function withResetChecklistItem(): DiagnosticPlaybook {
  return {
    ...playbook,
    evidenceChecklist: [
      ...(playbook.evidenceChecklist ?? []),
      {
        id: "ev_reset_attempted",
        actionId: "attempt_reset",
        description: "RESET button attempted.",
        type: "observation",
        required: false,
      },
    ],
  };
}

test("request inference does not coerce yes/no into numeric evidence", () => {
  const previousRequests: PlannerRequest[] = [
    {
      id: "ev_parts_age",
      type: "question",
      prompt: "What is the age of the tune-up kit or wear parts in months?",
      expectedInput: {
        type: "number",
        unit: "months",
      },
    },
  ];

  const inferred = inferEvidenceFromOutstandingRequest({
    message: "No.",
    outstandingRequestIds: ["ev_parts_age"],
    playbook,
    previousRequests,
  });

  assert.deepEqual(inferred, []);
});

test("request inference parses numeric values for numeric requests", () => {
  const previousRequests: PlannerRequest[] = [
    {
      id: "ev_parts_age",
      type: "question",
      prompt: "What is the age of the tune-up kit or wear parts in months?",
      expectedInput: {
        type: "number",
        unit: "months",
      },
    },
  ];

  const inferred = inferEvidenceFromOutstandingRequest({
    message: "About 18 months old",
    outstandingRequestIds: ["ev_parts_age"],
    playbook,
    previousRequests,
  });

  assert.deepEqual(inferred, [
    {
      evidenceId: "ev_parts_age",
      value: 18,
      confidence: "exact",
    },
  ]);
});

test("request inference still parses yes/no for boolean confirmations", () => {
  const previousRequests: PlannerRequest[] = [
    {
      id: "ev_freeze_mode",
      type: "question",
      prompt: "Is the machine in FREEZE mode?",
      expectedInput: {
        type: "boolean",
        options: ["Yes", "No"],
      },
    },
  ];

  const inferred = inferEvidenceFromOutstandingRequest({
    message: "Yes.",
    outstandingRequestIds: ["ev_freeze_mode"],
    playbook,
    previousRequests,
  });

  assert.deepEqual(inferred, [
    {
      evidenceId: "ev_freeze_mode",
      value: true,
      confidence: "exact",
    },
  ]);
});

test("request inference parses exact enum answers from the live request options", () => {
  const previousRequests: PlannerRequest[] = [
    {
      id: "attempt_reset",
      type: "question",
      prompt: "Please try using the RESET button if available and let me know the result.",
      expectedInput: {
        type: "enum",
        options: ["Completed", "No reset available", "Attempted but issue persists"],
      },
    },
  ];

  const inferred = inferEvidenceFromOutstandingRequest({
    message: "Attempted but issue persists.",
    outstandingRequestIds: ["attempt_reset"],
    playbook: withResetChecklistItem(),
    previousRequests,
  });

  assert.deepEqual(inferred, [
    {
      evidenceId: "ev_reset_attempted",
      value: "Attempted but issue persists",
      confidence: "exact",
    },
  ]);
});

test("request inference does not coerce unmatched enum answers", () => {
  const previousRequests: PlannerRequest[] = [
    {
      id: "attempt_reset",
      type: "question",
      prompt: "Please try using the RESET button if available and let me know the result.",
      expectedInput: {
        type: "enum",
        options: ["Completed", "No reset available", "Attempted but issue persists"],
      },
    },
  ];

  const inferred = inferEvidenceFromOutstandingRequest({
    message: "Yes",
    outstandingRequestIds: ["attempt_reset"],
    playbook: withResetChecklistItem(),
    previousRequests,
  });

  assert.deepEqual(inferred, []);
});

test("deterministic inferred evidence overrides conflicting planner extraction for the same request", () => {
  const merged = mergeInferredEvidenceWithPlannerOutput({
    plannerEvidence: [
      {
        evidenceId: "ev_freeze_mode",
        value: false,
        confidence: "exact",
      },
    ],
    inferredEvidence: [
      {
        evidenceId: "ev_freeze_mode",
        value: true,
        confidence: "exact",
      },
    ],
  });

  assert.deepEqual(merged, [
    {
      evidenceId: "ev_freeze_mode",
      value: true,
      confidence: "exact",
    },
  ]);
});
