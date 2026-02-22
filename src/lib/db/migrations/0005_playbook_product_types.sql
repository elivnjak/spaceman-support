CREATE TABLE IF NOT EXISTS "playbook_product_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "playbook_id" uuid NOT NULL REFERENCES "playbooks"("id") ON DELETE CASCADE,
  "product_type_id" uuid NOT NULL REFERENCES "product_types"("id") ON DELETE CASCADE,
  UNIQUE ("playbook_id", "product_type_id")
);
