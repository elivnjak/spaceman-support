CREATE TABLE IF NOT EXISTS "evidence_guide_images" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_path" text NOT NULL,
  "file_hash" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);
