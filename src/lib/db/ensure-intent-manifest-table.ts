import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Create intent_manifest table if missing.
 * This keeps admin/runtime endpoints functional even if migrations have not yet run.
 */
export async function ensureIntentManifestTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "intent_manifest" (
        "id" text PRIMARY KEY,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "updated_by" text,
        "updated_at" timestamp with time zone DEFAULT now()
      )
    `);
  } catch (error) {
    const pgError = error as {
      code?: string;
      constraint_name?: string;
      message?: string;
    };
    const duplicateTypeRace =
      pgError.code === "23505" &&
      pgError.constraint_name === "pg_type_typname_nsp_index";
    if (duplicateTypeRace || pgError.code === "42P07") {
      // Safe to ignore: another concurrent request created the table first.
      return;
    }
    throw error;
  }
}
