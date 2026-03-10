import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedInputToValueDefinition,
  getAllowedRuleOperators,
  getEffectiveValueDefinition,
  validateAndNormalizePlaybookV2,
} from "@/lib/playbooks/editor";
import type { CauseItem, EvidenceItem } from "@/lib/playbooks/schema";

test("expectedInputToValueDefinition derives enum and number contracts", () => {
  assert.deepEqual(expectedInputToValueDefinition({ type: "enum", options: ["A", "B"] }), {
    kind: "enum",
    options: ["A", "B"],
  });
  assert.deepEqual(
    expectedInputToValueDefinition({ type: "number", unit: "C", range: { min: -10, max: 10 } }),
    {
      kind: "number",
      unit: "C",
      notes: "Expected range -10 to 10",
    }
  );
});

test("getEffectiveValueDefinition prefers linked action contracts", () => {
  const evidence: EvidenceItem = {
    id: "ev_test",
    description: "Test",
    type: "observation",
    required: false,
    actionId: "confirm_state",
    valueDefinition: { kind: "text" },
  };
  const result = getEffectiveValueDefinition(
    evidence,
    new Map([
      [
        "confirm_state",
        {
          id: "confirm_state",
          expectedInput: { type: "boolean", options: ["Yes", "No"] },
        },
      ],
    ])
  );
  assert.deepEqual(result, { kind: "boolean", options: ["Yes", "No"] });
});

test("getAllowedRuleOperators constrains photo and number evidence", () => {
  assert.deepEqual(getAllowedRuleOperators({ kind: "photo" }), ["exists", "missing"]);
  assert.deepEqual(getAllowedRuleOperators({ kind: "number" }), [
    "exists",
    "missing",
    "equals",
    "not_equals",
    "between",
    "not_between",
  ]);
});

test("validateAndNormalizePlaybookV2 syncs action value definitions and validates references", () => {
  const evidenceChecklist: EvidenceItem[] = [
    {
      id: "ev_temp",
      description: "Temperature",
      type: "reading",
      required: true,
      actionId: "check_temperature",
    },
  ];
  const candidateCauses: CauseItem[] = [
    {
      id: "cause_hot",
      cause: "Too warm",
      likelihood: "high",
      outcome: "resolution",
      supportMode: "all",
      rulingEvidence: ["ev_temp"],
      supportRules: [
        {
          evidenceId: "ev_temp",
          operator: "between",
          min: 2,
          max: 10,
        },
      ],
    },
  ];
  const result = validateAndNormalizePlaybookV2({
    evidenceChecklist,
    candidateCauses,
    actionsById: new Map([
      [
        "check_temperature",
        {
          id: "check_temperature",
          expectedInput: { type: "number", unit: "C", range: { min: -20, max: 20 } },
        },
      ],
    ]),
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.normalizedEvidenceChecklist[0].valueDefinition, {
    kind: "number",
    unit: "C",
    notes: "Expected range -20 to 20",
  });
});

test("validateAndNormalizePlaybookV2 rejects invalid rule references and enum values", () => {
  const evidenceChecklist: EvidenceItem[] = [
    {
      id: "ev_mode",
      description: "Mode",
      type: "confirmation",
      required: true,
      valueDefinition: { kind: "enum", options: ["Freeze", "Wash"] },
    },
  ];
  const candidateCauses: CauseItem[] = [
    {
      id: "cause_bad",
      cause: "Bad",
      likelihood: "low",
      rulingEvidence: ["ev_missing"],
      supportRules: [
        {
          evidenceId: "ev_mode",
          operator: "equals",
          values: ["Standby"],
        },
      ],
    },
  ];
  const result = validateAndNormalizePlaybookV2({
    evidenceChecklist,
    candidateCauses,
    actionsById: new Map(),
  });
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message, /Unknown evidence reference/);
  assert.match(result.issues[1].message, /not a valid option/);
});
