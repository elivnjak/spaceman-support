import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { asc, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { playbooks } from "@/lib/db/schema";
import { buildPlaybookWorkbookBuffer } from "@/lib/playbooks/workbook";

async function main() {
  const outputDir = path.join(process.cwd(), "data", "playbook_workbooks");
  await mkdir(outputDir, { recursive: true });

  const rows = await db
    .select({ id: playbooks.id, title: playbooks.title, enabled: playbooks.enabled })
    .from(playbooks)
    .where(gte(playbooks.schemaVersion, 2))
    .orderBy(asc(playbooks.title));

  if (rows.length === 0) {
    console.log("No schema v2 playbooks found.");
    return;
  }

  for (const row of rows) {
    const { buffer, fileName } = await buildPlaybookWorkbookBuffer(row.id, db);
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, buffer);
    console.log(`${row.enabled ? "enabled" : "disabled"} ${row.id} -> ${filePath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
