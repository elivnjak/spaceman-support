import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailureLayer, scoreCandidateValidation } from "./fixes";
import type { ScenarioRunResult } from "./runner";

function buildResult(
  scenarioId: string,
  passed: boolean,
  failureCodes: string[] = []
): ScenarioRunResult {
  return {
    scenarioId,
    description: scenarioId,
    scenarioPath: `/tmp/${scenarioId}.json`,
    passed,
    failures: failureCodes.map((code) => ({
      code,
      message: code,
    })),
    turnResults: [],
    finalSnapshot: null,
  };
}

test("classifyFailureLayer prefers application code when audit errors are present", () => {
  const layer = classifyFailureLayer(buildResult("a", false, ["audit_errors_present"]));
  assert.equal(layer, "application_code");
});

test("scoreCandidateValidation rejects regressions", () => {
  const baseResults = [buildResult("a", false), buildResult("b", true)];
  const candidateResults = [buildResult("a", true), buildResult("b", false)];
  const scored = scoreCandidateValidation(baseResults, candidateResults);
  assert.equal(scored.accepted, false);
  assert.deepEqual(scored.fixedScenarioIds, ["a"]);
  assert.deepEqual(scored.regressedScenarioIds, ["b"]);
});
