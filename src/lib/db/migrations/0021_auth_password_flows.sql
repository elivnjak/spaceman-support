ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "force_password_change" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "token" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_unique"
  ON "password_reset_tokens" ("token");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx"
  ON "password_reset_tokens" ("user_id");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_at_idx"
  ON "password_reset_tokens" ("expires_at");

CREATE TABLE IF NOT EXISTS "auth_password_reset_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "email" text,
  "ip_address" text,
  "action" text NOT NULL,
  "outcome" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "auth_password_reset_attempts_created_at_idx"
  ON "auth_password_reset_attempts" ("created_at");

CREATE INDEX IF NOT EXISTS "auth_password_reset_attempts_email_idx"
  ON "auth_password_reset_attempts" ("email");