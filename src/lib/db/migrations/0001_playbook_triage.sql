ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "triage_history" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "triage_round" integer NOT NULL DEFAULT 0;

ALTER TABLE "diagnostic_sessions"
ALTER COLUMN "playbook_id" DROP NOT NULL;
