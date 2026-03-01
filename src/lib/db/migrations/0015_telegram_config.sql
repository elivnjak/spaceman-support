CREATE TABLE IF NOT EXISTS "telegram_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"bot_token" text DEFAULT '' NOT NULL,
	"chat_id" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
