CREATE TABLE IF NOT EXISTS "product_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "is_other" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "playbooks"
ADD COLUMN IF NOT EXISTS "requires_product_type" boolean NOT NULL DEFAULT false;

ALTER TABLE "diagnostic_sessions"
ADD COLUMN IF NOT EXISTS "product_type" text;

INSERT INTO "product_types" ("name", "is_other", "sort_order")
VALUES
  ('Yogurt', false, 1),
  ('Acai', false, 2),
  ('Ice Cream', false, 3),
  ('Other', true, 4)
ON CONFLICT ("name") DO NOTHING;
