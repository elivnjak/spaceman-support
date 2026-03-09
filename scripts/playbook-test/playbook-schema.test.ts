import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRulesJsonCell,
  playbookUsesStructuredSemantics,
  serializeRulesForWorkbook,
} from "@/lib/playbooks/schema";

test("playbookUsesStructuredSemantics detects evidence value definitions", () => {
  assert.equal(
    playbookUsesStructuredSemantics({
      evidenceChecklist: [
        {
          id: "ev_parts_age",
          description: "Age of parts",
          type: "confirmation",
          required: false,
          valueDefinition: {
            kind: "enum",
            options: ["Less than 6 months", "Unknown"],
          },
        },
      ],
      candidateCauses: [],
    }),
    true
  );
});

test("playbookUsesStructuredSemantics detects cause rules", () => {
  assert.equal(
    playbookUsesStructuredSemantics({
      evidenceChecklist: [],
      candidateCauses: [
        {
          id: "cause_1",
          cause: "Improper cleaning",
          likelihood: "high",
          rulingEvidence: ["ev_cleaning_done"],
          supportMode: "all",
          supportRules: [
            {
              evidenceId: "ev_cleaning_done",
              operator: "in",
              values: ["More than 72 hours ago"],
            },
          ],
        },
      ],
    }),
    true
  );
});

test("rules serialize and parse for workbook round-trip", () => {
  const serialized = serializeRulesForWorkbook([
    {
      evidenceId: "ev_cleaning_done",
      operator: "in",
      values: ["More than 72 hours ago"],
      rationale: "Overdue cleaning supports this cause.",
    },
  ]);

  assert.deepEqual(parseRulesJsonCell(serialized), [
    {
      evidenceId: "ev_cleaning_done",
      operator: "in",
      values: ["More than 72 hours ago"],
      rationale: "Overdue cleaning supports this cause.",
    },
  ]);
});
