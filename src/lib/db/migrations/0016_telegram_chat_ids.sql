-- Support multiple Telegram chat IDs for escalation notifications
ALTER TABLE "telegram_config" ADD COLUMN IF NOT EXISTS "chat_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- Backfill: copy existing single chat_id into chat_ids array
UPDATE "telegram_config"
SET "chat_ids" = to_jsonb(ARRAY["chat_id"])
WHERE "chat_id" IS NOT NULL AND trim("chat_id") != '';
