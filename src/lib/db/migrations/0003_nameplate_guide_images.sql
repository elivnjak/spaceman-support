CREATE TABLE IF NOT EXISTS "nameplate_guide_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_path" text NOT NULL,
  "file_hash" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

-- Backfill any legacy nameplate guide images that were stored in reference_images.
INSERT INTO "nameplate_guide_images" ("file_path", "file_hash", "notes")
SELECT "file_path", "file_hash", "notes"
FROM "reference_images"
WHERE "label_id" = '__nameplate_guide'
ON CONFLICT DO NOTHING;
