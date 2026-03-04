import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { telegramConfig } from "@/lib/db/schema";
import { logErrorEvent, withApiRouteErrorLogging } from "@/lib/error-logs";

function normalizeChatIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

async function sendTelegramTextMessage(opts: {
  token: string;
  chatId: string;
  text: string;
}): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(opts.token)}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId,
          text: opts.text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );
    if (!res.ok) {
      const responseText = await res.text();
      console.error(
        `[telegram-config] test sendMessage failed for ${opts.chatId}: ${res.status} ${responseText}`
      );
      await logErrorEvent({
        level: "error",
        route: "/api/admin/telegram-config/test",
        sessionId: null,
        message: `Telegram test sendMessage failed for chat ${opts.chatId}.`,
        context: {
          chatId: opts.chatId,
          status: res.status,
          body: responseText.slice(0, 1000),
        },
      }).catch(() => {});
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[telegram-config] test sendMessage failed for ${opts.chatId}:`,
      err instanceof Error ? err.message : err
    );
    await logErrorEvent({
      level: "error",
      route: "/api/admin/telegram-config/test",
      sessionId: null,
      message: `Telegram test sendMessage threw for chat ${opts.chatId}.`,
      error: err,
      context: {
        chatId: opts.chatId,
      },
    }).catch(() => {});
    return false;
  }
}

async function POSTHandler() {
  const [config] = await db.select().from(telegramConfig).limit(1);
  const token =
    config?.botToken?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatIdsFromConfig = normalizeChatIds(config?.chatIds);
  const legacyChatId = config?.chatId?.trim() ?? "";
  const chatIds =
    chatIdsFromConfig.length > 0
      ? chatIdsFromConfig
      : legacyChatId
        ? [legacyChatId]
        : process.env.TELEGRAM_CHAT_ID?.trim()
          ? [process.env.TELEGRAM_CHAT_ID.trim()]
          : [];

  if (!token) {
    return NextResponse.json(
      { error: "No Telegram bot token configured." },
      { status: 400 }
    );
  }
  if (chatIds.length === 0) {
    return NextResponse.json(
      { error: "No Telegram chat IDs configured." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const text = [
    "<b>Telegram escalation test</b>",
    "",
    "This is a test notification from admin settings.",
    `Time: ${now}`,
  ].join("\n");

  const results: Array<{ chatId: string; sent: boolean }> = [];
  let sentCount = 0;
  for (const chatId of chatIds) {
    const sent = await sendTelegramTextMessage({ token, chatId, text });
    results.push({ chatId, sent });
    if (sent) sentCount += 1;
  }

  return NextResponse.json({
    ok: sentCount > 0,
    sentCount,
    total: chatIds.length,
    results,
  });
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/telegram-config/test",
  POSTHandler
);
