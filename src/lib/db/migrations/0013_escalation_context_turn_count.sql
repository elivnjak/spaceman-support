ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "escalation_context_turn_count" integer NOT NULL DEFAULT 0;
