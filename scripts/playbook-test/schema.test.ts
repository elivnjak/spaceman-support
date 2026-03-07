import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { loadScenarioFile } from "./schema";

test("loadScenarioFile validates and resolves fixture references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playbook-schema-test-"));
  try {
    const scenarioDir = path.join(root, "scenario-a");
    await mkdir(path.join(scenarioDir, "fixtures"), { recursive: true });
    await writeFile(path.join(scenarioDir, "fixtures", "example.png"), "fixture", "utf-8");
    await writeFile(
      path.join(scenarioDir, "scenario.json"),
      JSON.stringify(
        {
          id: "scenario-a",
          description: "Example",
          turns: [
            {
              user: "hello",
              images: ["example.png"],
              expect: {},
            },
          ],
          finalExpect: {
            status: "active",
            phase: "triaging",
            playbookLabel: "too_runny",
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const loaded = await loadScenarioFile(path.join(scenarioDir, "scenario.json"));
    assert.equal(loaded.scenario.id, "scenario-a");
    assert.equal(loaded.scenario.turns[0]?.images[0], "example.png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
