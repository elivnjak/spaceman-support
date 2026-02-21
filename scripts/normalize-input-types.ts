import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { actions, playbooks } from "../src/lib/db/schema";
import { loadActionCatalogRows, recommendEvidenceTypeFromExpectedInput } from "../src/lib/actions/catalog";

type EvidenceType = "photo" | "reading" | "observation" | "action" | "confirmation";

type EvidenceItem = {
  id: string;
  description?: string;
  actionId?: string;
  type?: EvidenceType;
  required?: boolean;
};

function readEvidenceChecklist(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => typeof x === "object" && x !== null) as EvidenceItem[];
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function upsertActions(apply: boolean) {
  const rows = loadActionCatalogRows();
  let changeCount = 0;
  for (const row of rows) {
    const payload = {
      id: row.actionId,
      title: row.name,
      instructions: row.description,
      expectedInput: row.expectedInput as unknown as Record<string, unknown>,
      safetyLevel: row.safetyLevel,
      appliesToModels: null,
      updatedAt: new Date(),
    };
    if (apply) {
      await db
        .insert(actions)
        .values(payload)
        .onConflictDoUpdate({
          target: actions.id,
          set: {
            title: payload.title,
            instructions: payload.instructions,
            expectedInput: payload.expectedInput,
            safetyLevel: payload.safetyLevel,
            appliesToModels: payload.appliesToModels,
            updatedAt: payload.updatedAt,
          },
        });
    }
    changeCount += 1;
  }
  return changeCount;
}

async function normalizePlaybooks(apply: boolean) {
  const catalog = loadActionCatalogRows();
  const actionById = new Map(catalog.map((a) => [a.actionId, a]));
  const list = await db.select().from(playbooks);
  let playbooksUpdated = 0;
  let evidenceUpdated = 0;

  for (const pb of list) {
    const evidence = readEvidenceChecklist(pb.evidenceChecklist);
    if (evidence.length === 0) continue;
    let changed = false;
    const nextEvidence = evidence.map((item) => {
      if (!item.actionId) return item;
      const action = actionById.get(item.actionId);
      if (!action) return item;
      const currentType = (item.type ?? "observation") as EvidenceType;
      const recommended = recommendEvidenceTypeFromExpectedInput(action.expectedInput.type, currentType);
      if (recommended === currentType) return item;
      changed = true;
      evidenceUpdated += 1;
      return { ...item, type: recommended };
    });
    if (changed) {
      playbooksUpdated += 1;
      if (apply) {
        await db
          .update(playbooks)
          .set({ evidenceChecklist: nextEvidence as unknown as Record<string, unknown>, updatedAt: new Date() })
          .where(eq(playbooks.id, pb.id));
      }
    }
  }

  return { playbooksUpdated, evidenceUpdated };
}

async function main() {
  const mode = getArg("--mode") ?? "dry-run";
  const apply = mode === "apply";
  if (mode !== "dry-run" && mode !== "apply") {
    throw new Error("Invalid --mode. Use --mode dry-run or --mode apply");
  }

  console.log(`Running input normalization in ${mode} mode`);
  const actionChanges = await upsertActions(apply);
  const playbookChanges = await normalizePlaybooks(apply);

  console.log(`Actions normalized: ${actionChanges}`);
  console.log(`Playbooks updated: ${playbookChanges.playbooksUpdated}`);
  console.log(`Evidence rows updated: ${playbookChanges.evidenceUpdated}`);
  if (!apply) {
    console.log("Dry-run only. Re-run with --mode apply to persist changes.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
