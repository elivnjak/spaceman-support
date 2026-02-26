ALTER TABLE "diagnostic_sessions" ADD COLUMN IF NOT EXISTS "user_name" text;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD COLUMN IF NOT EXISTS "user_phone" text;
