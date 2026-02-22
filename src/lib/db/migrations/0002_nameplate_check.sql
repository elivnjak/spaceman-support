CREATE TABLE IF NOT EXISTS "supported_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "model_number" text NOT NULL UNIQUE,
  "display_name" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "nameplate_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instruction_text" text NOT NULL,
  "guide_image_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "serial_number" text;

ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "manufacturing_year" integer;
