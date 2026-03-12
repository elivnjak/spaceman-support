import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildSchemaSignature } from "./schema-signature";
import {
  actions,
  auditLogs,
  authPasswordResetAttempts,
  clearanceConfig,
  clearanceGuideImages,
  diagnosisModeConfig,
  diagnosticSessions,
  docChunks,
  documents,
  intentManifest,
  labels,
  machineSpecs,
  maintenanceConfig,
  nameplateConfig,
  nameplateGuideImages,
  passwordResetTokens,
  playbookProductTypes,
  playbooks,
  productTypes,
  referenceImages,
  sessions,
  supportedModels,
  supportSessions,
  telegramConfig,
  ticketNotes,
  users,
} from "@/lib/db/schema";

type ManagedTable = {
  name: string;
  table: any;
  selfReferential?: boolean;
};

export const MANAGED_BACKUP_TABLES: ManagedTable[] = [
  { name: "labels", table: labels },
  { name: "supported_models", table: supportedModels },
  { name: "product_types", table: productTypes },
  { name: "users", table: users },
  { name: "password_reset_tokens", table: passwordResetTokens },
  { name: "auth_password_reset_attempts", table: authPasswordResetAttempts },
  { name: "sessions", table: sessions },
  { name: "reference_images", table: referenceImages },
  { name: "documents", table: documents },
  { name: "doc_chunks", table: docChunks },
  { name: "actions", table: actions },
  { name: "playbooks", table: playbooks },
  { name: "playbook_product_types", table: playbookProductTypes },
  { name: "nameplate_config", table: nameplateConfig },
  { name: "nameplate_guide_images", table: nameplateGuideImages },
  { name: "clearance_config", table: clearanceConfig },
  { name: "clearance_guide_images", table: clearanceGuideImages },
  { name: "maintenance_config", table: maintenanceConfig },
  { name: "diagnosis_mode_config", table: diagnosisModeConfig },
  { name: "telegram_config", table: telegramConfig },
  { name: "intent_manifest", table: intentManifest },
  { name: "support_sessions", table: supportSessions, selfReferential: true },
  { name: "diagnostic_sessions", table: diagnosticSessions },
  { name: "audit_logs", table: auditLogs },
  { name: "ticket_notes", table: ticketNotes },
  { name: "machine_specs", table: machineSpecs },
];

const INSERT_CHUNK_SIZE = 250;

export function getManagedTableNames(): string[] {
  return MANAGED_BACKUP_TABLES.map((table) => table.name);
}

export async function computeSchemaSignatureVariants(): Promise<{
  normalized: string;
  legacy: string;
}> {
  const schemaPath = path.resolve(process.cwd(), "src/lib/db/schema.ts");
  const schemaContent = await readFile(schemaPath);

  const migrationsRoot = path.resolve(process.cwd(), "src/lib/db/migrations");
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationEntries = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map(async (entry) => ({
        fileName: entry.name,
        content: await readFile(path.join(migrationsRoot, entry.name)),
      }))
  );

  return {
    normalized: buildSchemaSignature({
      schemaContent,
      migrationEntries,
      normalizeLineEndings: true,
    }),
    legacy: buildSchemaSignature({
      schemaContent,
      migrationEntries,
      normalizeLineEndings: false,
    }),
  };
}

export async function computeSchemaSignature(): Promise<string> {
  return (await computeSchemaSignatureVariants()).normalized;
}

export async function exportDatabaseToDirectory(
  dbDir: string
): Promise<{ rowCounts: Record<string, number> }> {
  await rm(dbDir, { recursive: true, force: true });
  await mkdir(dbDir, { recursive: true });

  const rowCounts: Record<string, number> = {};

  for (const managedTable of MANAGED_BACKUP_TABLES) {
    const rows = (await db.select().from(managedTable.table)) as Record<string, unknown>[];
    rowCounts[managedTable.name] = rows.length;
    const content = rows.map((row) => JSON.stringify(row)).join("\n");
    await writeFile(
      path.join(dbDir, `${managedTable.name}.jsonl`),
      content ? `${content}\n` : "",
      "utf8"
    );
  }

  return { rowCounts };
}

function parseJsonLines(content: string): Record<string, unknown>[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function insertRows(managedTable: ManagedTable, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;

  if (managedTable.selfReferential) {
    await db.insert(managedTable.table).values(rows as never);
    return;
  }

  for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE);
    await db.insert(managedTable.table).values(chunk as never);
  }
}

export async function restoreDatabaseFromDirectory(dbDir: string): Promise<void> {
  for (const managedTable of [...MANAGED_BACKUP_TABLES].reverse()) {
    await db.execute(sql.raw(`DELETE FROM "${managedTable.name}"`));
  }

  for (const managedTable of MANAGED_BACKUP_TABLES) {
    const content = await readFile(path.join(dbDir, `${managedTable.name}.jsonl`), "utf8");
    const rows = parseJsonLines(content);
    await insertRows(managedTable, rows);
  }
}
