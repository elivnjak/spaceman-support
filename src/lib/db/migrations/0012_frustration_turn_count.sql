ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "frustration_turn_count" integer NOT NULL DEFAULT 0;
