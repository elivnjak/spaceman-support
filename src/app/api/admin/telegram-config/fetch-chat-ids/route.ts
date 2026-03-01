import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { telegramConfig } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type TelegramChat = {
  id: string;
  type: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

async function GETHandler() {
  const [config] = await db.select().from(telegramConfig).limit(1);
  const token =
    config?.botToken?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  if (!token) {
    return NextResponse.json(
      { error: "Save your bot token first, then fetch chat IDs." },
      { status: 400 }
    );
  }

  const apiUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?limit=100`;
  let res: Response;
  try {
    res = await fetch(apiUrl);
  } catch (err) {
    console.error("[telegram] getUpdates request failed:", err);
    return NextResponse.json(
      { error: "Could not reach Telegram. Check your connection." },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const text = await res.text();
    console.error("[telegram] getUpdates failed:", res.status, text);
    return NextResponse.json(
      { error: "Telegram API error. Check that your bot token is correct." },
      { status: 400 }
    );
  }

  const data = (await res.json()) as {
    ok?: boolean;
    result?: Array<{
      message?: {
        chat: {
          id: number;
          type: string;
          title?: string;
          username?: string;
          first_name?: string;
          last_name?: string;
        };
      };
    }>;
  };

  const result = data.result ?? [];
  const seen = new Set<string>();
  const chats: TelegramChat[] = [];
  for (const update of result) {
    const chat = update.message?.chat;
    if (!chat) continue;
    const id = String(chat.id);
    if (seen.has(id)) continue;
    seen.add(id);
    chats.push({
      id,
      type: chat.type,
      title: chat.title,
      username: chat.username,
      firstName: chat.first_name,
      lastName: chat.last_name,
    });
  }

  return NextResponse.json({ chats });
}

export const GET = withApiRouteErrorLogging(
  "/api/admin/telegram-config/fetch-chat-ids",
  GETHandler
);
