import "dotenv/config";
import { db } from "../src/lib/db";
import { actions, playbooks } from "../src/lib/db/schema";
import { loadActionCatalogRows, recommendEvidenceTypeFromExpectedInput } from "../src/lib/actions/catalog";

type EvidenceType = "photo" | "reading" | "observation" | "action" | "confirmation";

type EvidenceItem = {
  id: string;
  actionId?: string;
  type?: EvidenceType;
};

function readEvidenceChecklist(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => typeof x === "object" && x !== null) as EvidenceItem[];
}

async function main() {
  const catalogRows = loadActionCatalogRows();
  const byType = new Map<string, number>();
  let enumCount = 0;
  let booleanCount = 0;
  let numberCount = 0;
  let photoCount = 0;
  let textCount = 0;
  for (const row of catalogRows) {
    byType.set(row.expectedInput.type, (byType.get(row.expectedInput.type) ?? 0) + 1);
    if (row.expectedInput.type === "enum") enumCount += 1;
    if (row.expectedInput.type === "boolean") booleanCount += 1;
    if (row.expectedInput.type === "number") numberCount += 1;
    if (row.expectedInput.type === "photo") photoCount += 1;
    if (row.expectedInput.type === "text") textCount += 1;
  }

  console.log("=== Source action catalog audit ===");
  console.log(`Total catalog actions: ${catalogRows.length}`);
  console.log(`Enum: ${enumCount}, Boolean: ${booleanCount}, Number: ${numberCount}, Photo: ${photoCount}, Text: ${textCount}`);

  const actionMap = new Map(catalogRows.map((a) => [a.actionId, a]));

  const dbActions = await db.select().from(actions);
  console.log("\n=== Live DB actions audit ===");
  console.log(`Total DB actions: ${dbActions.length}`);

  const missingInDb = catalogRows.filter((a) => !dbActions.some((d) => d.id === a.actionId));
  const missingInCatalog = dbActions.filter((d) => !actionMap.has(d.id));
  console.log(`Missing in DB (from catalog): ${missingInDb.length}`);
  console.log(`Missing in catalog (DB-only): ${missingInCatalog.length}`);

  const dbPlaybooks = await db.select().from(playbooks);
  let totalEvidence = 0;
  let mismatchedEvidenceType = 0;
  const mismatchExamples: string[] = [];
  for (const pb of dbPlaybooks) {
    const evidence = readEvidenceChecklist(pb.evidenceChecklist);
    for (const item of evidence) {
      totalEvidence += 1;
      if (!item.actionId) continue;
      const action = actionMap.get(item.actionId);
      if (!action) continue;
      const currentType = (item.type ?? "observation") as EvidenceType;
      const recommended = recommendEvidenceTypeFromExpectedInput(action.expectedInput.type, currentType);
      if (recommended !== currentType) {
        mismatchedEvidenceType += 1;
        if (mismatchExamples.length < 25) {
          mismatchExamples.push(
            `${pb.labelId}:${item.id} action=${item.actionId} current=${currentType} recommended=${recommended}`
          );
        }
      }
    }
  }

  console.log("\n=== Live DB playbook evidence audit ===");
  console.log(`Total evidence checklist rows: ${totalEvidence}`);
  console.log(`Rows with recommended type change: ${mismatchedEvidenceType}`);
  if (mismatchExamples.length > 0) {
    console.log("\nExamples:");
    mismatchExamples.forEach((line) => console.log(`- ${line}`));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
