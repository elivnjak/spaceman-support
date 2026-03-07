import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { createSandbox } from "./sandbox";
import { loadScenarioSuite } from "./schema";

const shouldRunIntegration = process.env.PLAYBOOK_TEST_INTEGRATION === "1";

test("integration harness setup", { skip: !shouldRunIntegration }, async () => {
  const sandbox = await createSandbox();
  try {
    const scenarios = await loadScenarioSuite(
      path.join(process.cwd(), "data", "playbook_tests")
    );
    assert.ok(scenarios.length > 0);
  } finally {
    await sandbox.cleanup();
  }
});
