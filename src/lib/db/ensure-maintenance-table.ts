import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Create maintenance_config table if missing.
 * Call before any maintenance-related DB access so endpoints work even when
 * migrations have not been run on the current database.
 */
export async function ensureMaintenanceTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "maintenance_config" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "enabled" boolean NOT NULL DEFAULT false,
      "icon_path" text,
      "title" text NOT NULL DEFAULT 'Chat Unavailable',
      "description" text NOT NULL DEFAULT 'Our support chat is currently undergoing maintenance.',
      "phone" text NOT NULL DEFAULT '',
      "email" text NOT NULL DEFAULT '',
      "updated_at" timestamp with time zone DEFAULT now()
    )
  `);
}
