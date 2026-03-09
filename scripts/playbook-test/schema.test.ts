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
              inputSource: "skip",
              images: ["example.png"],
              expect: {},
            },
          ],
          finalExpect: {
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
    assert.equal(loaded.scenario.turns[0]?.inputSource, "skip");
    assert.equal(loaded.scenario.turns[0]?.images[0], "example.png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadScenarioFile validates auto-response fixture references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "playbook-schema-test-"));
  try {
    const scenarioDir = path.join(root, "scenario-b");
    await mkdir(path.join(scenarioDir, "fixtures"), { recursive: true });
    await writeFile(
      path.join(scenarioDir, "scenario.json"),
      JSON.stringify(
        {
          id: "scenario-b",
          description: "Missing auto-response fixture",
          autoResponse: {
            answers: {
              request_photo: {
                user: "Attached.",
                images: ["missing.png"],
              },
            },
          },
          turns: [
            {
              user: "hello",
              expect: {},
            },
          ],
          finalExpect: {
            playbookLabel: "too_runny",
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    await assert.rejects(
      () => loadScenarioFile(path.join(scenarioDir, "scenario.json")),
      /references missing fixture "missing\.png"/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
