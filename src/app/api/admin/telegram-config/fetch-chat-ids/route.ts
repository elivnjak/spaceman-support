import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { telegramConfig } from "@/lib/db/schema";
import { logErrorEvent, withApiRouteErrorLogging } from "@/lib/error-logs";
import { getTelegramJson } from "@/lib/telegram";

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
    process.env.TELEGRAM_BOT_TOKEN?.trim() || config?.botToken?.trim() || "";
  if (!token) {
    return NextResponse.json(
      { error: "Save your bot token first, then fetch chat IDs." },
      { status: 400 }
    );
  }

  const res = await getTelegramJson(token, "getUpdates", { limit: 100 });

  if (!res.ok) {
    const detail = res.error ?? res.body ?? "";
    if (res.status === undefined) {
      console.error("[telegram] getUpdates request failed:", detail);
      await logErrorEvent({
        level: "error",
        route: "/api/admin/telegram-config/fetch-chat-ids",
        sessionId: null,
        message: "Telegram getUpdates request failed.",
        context: {
          detail: detail.slice(0, 1000),
          transport: res.transport ?? "unknown",
        },
      }).catch(() => {});
      return NextResponse.json(
        { error: "Could not reach Telegram. Check your connection and try again." },
        { status: 502 }
      );
    }

    console.error("[telegram] getUpdates failed:", res.status, detail);
    await logErrorEvent({
      level: "error",
      route: "/api/admin/telegram-config/fetch-chat-ids",
      sessionId: null,
      message: `Telegram getUpdates failed with status ${res.status}.`,
      context: {
        status: res.status,
        body: detail.slice(0, 1000),
        transport: res.transport ?? "unknown",
      },
    }).catch(() => {});
    return NextResponse.json(
      { error: "Telegram API error. Check that your bot token is correct." },
      { status: 400 }
    );
  }

  let data: {
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
  try {
    data = JSON.parse(res.body || "{}") as typeof data;
  } catch (err) {
    console.error("[telegram] getUpdates returned invalid JSON:", res.body);
    await logErrorEvent({
      level: "error",
      route: "/api/admin/telegram-config/fetch-chat-ids",
      sessionId: null,
      message: "Telegram getUpdates returned invalid JSON.",
      error: err,
      context: {
        body: (res.body || "").slice(0, 1000),
        transport: res.transport ?? "unknown",
      },
    }).catch(() => {});
    return NextResponse.json(
      { error: "Telegram returned an unexpected response. Please try again." },
      { status: 502 }
    );
  }

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
