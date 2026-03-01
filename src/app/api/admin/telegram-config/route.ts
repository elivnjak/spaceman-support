import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { telegramConfig } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

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
      console.error(
        `[telegram-config] sendMessage failed for ${opts.chatId}: ${res.status} ${await res.text()}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[telegram-config] sendMessage failed for ${opts.chatId}:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

function normalizeChatIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

async function GETHandler() {
  const [config] = await db.select().from(telegramConfig).limit(1);
  const chatIds = normalizeChatIds(config?.chatIds);
  const legacyChatId = config?.chatId?.trim() ?? "";
  const chatIdsList =
    chatIds.length > 0 ? chatIds : legacyChatId ? [legacyChatId] : [];
  return NextResponse.json({
    enabled: config?.enabled ?? false,
    botToken: config?.botToken ?? "",
    chatId: legacyChatId,
    chatIds: chatIdsList,
  });
}

async function PUTHandler(request: Request) {
  const body = (await request.json()) as {
    enabled?: boolean;
    botToken?: string;
    chatId?: string;
    chatIds?: string[];
  };
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const botToken =
    typeof body.botToken === "string" ? body.botToken.trim() : undefined;
  const chatIds =
    Array.isArray(body.chatIds) ? normalizeChatIds(body.chatIds) : undefined;

  const [existing] = await db.select().from(telegramConfig).limit(1);
  const existingChatIds = normalizeChatIds(existing?.chatIds);
  const legacyChatId = existing?.chatId?.trim() ?? "";
  const existingEffectiveChatIds =
    existingChatIds.length > 0
      ? existingChatIds
      : legacyChatId
        ? [legacyChatId]
        : [];
  const updates: {
    enabled?: boolean;
    botToken?: string;
    chatIds?: string[];
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (enabled !== undefined) updates.enabled = enabled;
  if (botToken !== undefined) updates.botToken = botToken;
  if (chatIds !== undefined) updates.chatIds = chatIds;

  if (existing) {
    await db
      .update(telegramConfig)
      .set(updates)
      .where(eq(telegramConfig.id, existing.id));
  } else {
    await db.insert(telegramConfig).values({
      enabled: updates.enabled ?? false,
      botToken: updates.botToken ?? "",
      chatId: "",
      chatIds: updates.chatIds ?? [],
      updatedAt: updates.updatedAt,
    });
  }

  const finalToken =
    (botToken ?? existing?.botToken ?? "").trim() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    "";
  const finalChatIds = chatIds ?? existingEffectiveChatIds;
  const addedChatIds = finalChatIds.filter((id) => !existingEffectiveChatIds.includes(id));
  const removedChatIds = existingEffectiveChatIds.filter((id) => !finalChatIds.includes(id));
  let welcomeSentCount = 0;
  let removedSentCount = 0;
  if (finalToken && addedChatIds.length > 0) {
    const welcomeText = [
      "<b>Escalation notifications enabled</b>",
      "",
      "This chat was added as a recipient for support escalation alerts.",
      "You will now receive new escalation notifications from the assistant.",
    ].join("\n");
    for (const addedChatId of addedChatIds) {
      const sent = await sendTelegramTextMessage({
        token: finalToken,
        chatId: addedChatId,
        text: welcomeText,
      });
      if (sent) welcomeSentCount += 1;
    }
  }
  if (finalToken && removedChatIds.length > 0) {
    const removedText = [
      "<b>Escalation notifications disabled</b>",
      "",
      "This chat was removed from support escalation recipients.",
      "You will no longer receive new escalation notifications from the assistant.",
    ].join("\n");
    for (const removedChatId of removedChatIds) {
      const sent = await sendTelegramTextMessage({
        token: finalToken,
        chatId: removedChatId,
        text: removedText,
      });
      if (sent) removedSentCount += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    welcomeSentCount,
    addedChatIdsCount: addedChatIds.length,
    removedSentCount,
    removedChatIdsCount: removedChatIds.length,
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/telegram-config", GETHandler);

export const PUT = withApiRouteErrorLogging("/api/admin/telegram-config", PUTHandler);
