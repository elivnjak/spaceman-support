ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "ingestion_progress" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "ingestion_stage" text,
  ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "ingestion_started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "ingestion_completed_at" timestamp with time zone;

UPDATE "documents"
SET
  "ingestion_progress" = CASE
    WHEN "status" = 'READY' THEN 100
    WHEN "status" = 'INGESTING' THEN 10
    ELSE 0
  END,
  "ingestion_stage" = CASE
    WHEN "status" = 'READY' THEN 'Complete'
    WHEN "status" = 'INGESTING' THEN 'Ingesting'
    WHEN "status" = 'ERROR' THEN 'Failed'
    ELSE NULL
  END;
