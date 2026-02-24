ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "verification_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "verification_responded_at" timestamp with time zone;
