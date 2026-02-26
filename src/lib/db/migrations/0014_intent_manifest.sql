-- intent_manifest: single-row config for intent manifest overrides (admin-managed).
-- Created by migration so schema is managed in one place; no runtime CREATE TABLE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'intent_manifest'
  ) THEN
    CREATE TABLE "intent_manifest" (
      "id" text PRIMARY KEY,
      "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "updated_by" text,
      "updated_at" timestamp with time zone DEFAULT now()
    );
  END IF;
END $$;
