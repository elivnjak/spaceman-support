import "dotenv/config";
import { writeFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { actions, playbooks } from "@/lib/db/schema";
import { CauseItemSchema } from "@/lib/playbooks/schema";
import { createDatabaseClient } from "./playbook-test/sandbox";
import {
  buildFallbackResolutionBlueprintForCause,
  loadReferenceData,
} from "./playbook-test/generate";

const PLAYBOOK_ID = "85ffe006-7aa7-44a1-ab7f-e01960f01ca7";
const CAUSE_IDS = [
  "cause_hot_gas_release",
  "cause_product_settled",
  "cause_environment_heat",
] as const;
const EVIDENCE_IDS = [
  "ev_idle_time",
  "confirm_idle_time",
  "ev_hot_gas_setting_known",
  "ev_freeze_mode",
  "check_mode_freeze",
  "ev_airflow_clearance",
  "check_airflow_clearance",
] as const;
const ACTION_IDS = ["confirm_idle_time", "check_mode_freeze", "check_airflow_clearance"] as const;

async function main() {
  const database = createDatabaseClient();
  try {
    const [playbook] = await database.db
      .select()
      .from(playbooks)
      .where(eq(playbooks.id, PLAYBOOK_ID))
      .limit(1);

    if (!playbook) {
      throw new Error(`Playbook not found: ${PLAYBOOK_ID}`);
    }

    const { actionsById } = await loadReferenceData(database.db);
    const actionRows = await database.db
      .select({ id: actions.id, title: actions.title, expectedInput: actions.expectedInput })
      .from(actions);
    const rawCauses = Array.isArray(playbook.candidateCauses) ? playbook.candidateCauses : [];
    const selectedActionRows = actionRows.filter((row) => ACTION_IDS.includes(row.id as (typeof ACTION_IDS)[number]));

    const result = CAUSE_IDS.map((causeId) => {
      const rawCause = rawCauses.find(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && (item as { id?: unknown }).id === causeId
      );
      if (!rawCause) {
        return { causeId, error: "missing-cause" };
      }

      const cause = CauseItemSchema.parse(rawCause);
      const blueprint = buildFallbackResolutionBlueprintForCause(playbook, cause, actionsById);
      if (!blueprint) {
        return { causeId, error: "missing-blueprint" };
      }

      return {
        causeId,
        targetCauseId: blueprint.targetCauseId,
        supportRules: cause.supportRules ?? [],
        excludeRules: cause.excludeRules ?? [],
        answers: Object.fromEntries(
          EVIDENCE_IDS.map((evidenceId) => [evidenceId, blueprint.answers[evidenceId]?.user ?? null])
        ),
      };
    });

    const payload = {
      env: {
        PLAYBOOK_TEST_GENERATOR_USE_AI: process.env.PLAYBOOK_TEST_GENERATOR_USE_AI ?? "<unset>",
        DATABASE_URL: process.env.DATABASE_URL ?? "<unset>",
        DATABASE_SCHEMA: process.env.DATABASE_SCHEMA ?? "<unset>",
      },
      playbook: {
        id: playbook.id,
        labelId: playbook.labelId,
        title: playbook.title,
        schemaVersion: playbook.schemaVersion,
        updatedAt: playbook.updatedAt,
      },
      actions: selectedActionRows,
      causes: result,
    };

    const outputPath = "tmp/ss-first-pull-blueprint-probe.json";
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    console.log(outputPath);
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

