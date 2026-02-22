import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Create nameplate tables and add nameplate columns to diagnostic_sessions if missing.
 * Call before any nameplate-related DB access so endpoints work even when
 * migrations have not been run on the current database.
 */
export async function ensureNameplateTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "nameplate_config" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "instruction_text" text NOT NULL,
      "guide_image_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "updated_at" timestamp with time zone DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "nameplate_guide_images" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "file_path" text NOT NULL,
      "file_hash" text,
      "notes" text,
      "created_at" timestamp with time zone DEFAULT now()
    )
  `);
  await db.execute(sql`
    ALTER TABLE "diagnostic_sessions"
    ADD COLUMN IF NOT EXISTS "serial_number" text
  `);
  await db.execute(sql`
    ALTER TABLE "diagnostic_sessions"
    ADD COLUMN IF NOT EXISTS "manufacturing_year" integer
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "supported_models" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "model_number" text NOT NULL UNIQUE,
      "display_name" text,
      "created_at" timestamp with time zone DEFAULT now()
    )
  `);
}
