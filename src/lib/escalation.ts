import type { ChatMessage, EvidenceRecord, HypothesisState, PlannerOutput } from "./pipeline/diagnostic-planner";
import { db } from "@/lib/db";
import { telegramConfig } from "@/lib/db/schema";
import { getIntentManifest } from "@/lib/intent/loader";
import { readStorageFile } from "@/lib/storage";
import { sanitizeRichTextHtml } from "@/lib/rich-text";

function getBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function normalizeImagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getImageContentType(imagePath: string): string {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value == null ? "" : value;
  });
}

export type EscalationHandoff = {
  sessionId: string;
  userName: string | null;
  userPhone: string | null;
  machineModel: string | null;
  serialNumber: string | null;
  productType: string | null;
  manufacturingYear: number | null;
  escalationReason: string;
  playbookTitle: string;
  labelId: string;
  turnCount: number;
  ticketUrl: string | null;
  clearanceImagePaths: string[];
  userImagePaths: string[];
  /** Summary of evidence collected during the session */
  evidenceCollected: Record<string, {
    value: unknown;
    type: string;
    confidence: string;
  }>;
  /** Current hypothesis state at time of escalation */
  hypotheses: {
    causeId: string;
    confidence: number;
    status: string;
    reasoning: string;
  }[];
  /** Last N user messages for context */
  recentUserMessages: string[];
  /** Steps already attempted (from prior resolution, if any) */
  stepsAttempted: { stepId: string; instruction: string }[];
  /** Timestamp of escalation */
  escalatedAt: string;
};

export function buildEscalationHandoff(opts: {
  sessionId: string;
  userName: string | null;
  userPhone: string | null;
  machineModel: string | null;
  serialNumber: string | null;
  productType: string | null;
  manufacturingYear: number | null;
  clearanceImagePaths: unknown;
  escalationReason: string;
  playbookTitle: string;
  labelId: string;
  turnCount: number;
  evidence: Record<string, EvidenceRecord>;
  hypotheses: HypothesisState[];
  messages: ChatMessage[];
  resolution?: PlannerOutput["resolution"];
}): EscalationHandoff {
  const baseUrl = getBaseUrl();
  const ticketUrl = baseUrl ? `${baseUrl}/admin/tickets/${opts.sessionId}` : null;

  const recentUserMessages = opts.messages
    .filter((m) => m.role === "user")
    .slice(-5)
    .map((m) => m.content);

  const userImagePaths = Array.from(
    new Set(
      opts.messages
        .filter((m) => m.role === "user")
        .flatMap((m) => normalizeImagePaths((m as { images?: unknown }).images))
    )
  );
  const clearanceImagePaths = Array.from(
    new Set(normalizeImagePaths(opts.clearanceImagePaths))
  );

  const evidenceCollected: EscalationHandoff["evidenceCollected"] = {};
  for (const [key, rec] of Object.entries(opts.evidence)) {
    evidenceCollected[key] = {
      value: rec.value,
      type: rec.type,
      confidence: rec.confidence,
    };
  }

  const stepsAttempted = (opts.resolution?.steps ?? []).map((s) => ({
    stepId: s.step_id,
    instruction: s.instruction,
  }));

  return {
    sessionId: opts.sessionId,
    userName: opts.userName ?? null,
    userPhone: opts.userPhone ?? null,
    machineModel: opts.machineModel ?? null,
    serialNumber: opts.serialNumber ?? null,
    productType: opts.productType ?? null,
    manufacturingYear: opts.manufacturingYear ?? null,
    escalationReason: opts.escalationReason,
    playbookTitle: opts.playbookTitle,
    labelId: opts.labelId,
    turnCount: opts.turnCount,
    ticketUrl,
    clearanceImagePaths,
    userImagePaths,
    evidenceCollected,
    hypotheses: opts.hypotheses.map((h) => ({
      causeId: h.causeId,
      confidence: h.confidence,
      status: h.status,
      reasoning: h.reasoning,
    })),
    recentUserMessages,
    stepsAttempted,
    escalatedAt: new Date().toISOString(),
  };
}

/**
 * Send escalation handoff to external webhook if configured.
 * Non-blocking: logs errors but never throws to prevent disrupting the user flow.
 */
export async function sendEscalationWebhook(handoff: EscalationHandoff): Promise<boolean> {
  const webhookUrl = process.env.ESCALATION_WEBHOOK_URL;
  if (!webhookUrl) {
    if (process.env.NODE_ENV !== "test") {
      console.log("[escalation] No ESCALATION_WEBHOOK_URL configured; skipping webhook");
    }
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(handoff),
    });
    if (!res.ok) {
      console.error(`[escalation] Webhook returned ${res.status}: ${await res.text()}`);
      return false;
    }
    if (process.env.NODE_ENV !== "test") {
      console.log(`[escalation] Webhook sent for session ${handoff.sessionId}`);
    }
    return true;
  } catch (err) {
    console.error("[escalation] Webhook failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function getTelegramChatIds(storedConfig: { chatIds?: unknown; chatId?: string | null } | null): string[] {
  const fromArray = normalizeStringArray(storedConfig?.chatIds);
  if (fromArray.length > 0) return fromArray;
  const legacy = storedConfig?.chatId?.trim();
  return legacy ? [legacy] : [];
}

export async function sendEscalationTelegram(handoff: EscalationHandoff): Promise<boolean> {
  const [storedConfig] = await db.select().from(telegramConfig).limit(1);
  const token = storedConfig?.botToken?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatIds = getTelegramChatIds(storedConfig);
  const envChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const allChatIds = chatIds.length > 0 ? chatIds : envChatId ? [envChatId] : [];
  const enabled = storedConfig ? storedConfig.enabled : Boolean(token && allChatIds.length > 0);

  if (!enabled || !token || allChatIds.length === 0) {
    if (process.env.NODE_ENV !== "test") {
      console.log("[escalation] Telegram disabled or not configured; skipping message");
    }
    return false;
  }

  const customer = handoff.userName?.trim() || "Unknown customer";
  const machine = handoff.machineModel?.trim() || "Unknown model";
  const serial = handoff.serialNumber?.trim() || "Unknown";
  const productType = handoff.productType?.trim() || "Unknown";
  const year = handoff.manufacturingYear != null ? String(handoff.manufacturingYear) : "Unknown";
  const phone = handoff.userPhone?.trim() || "Unknown";
  const tel = handoff.userPhone?.replace(/[^\d+]/g, "") || "";
  const intentManifest = await getIntentManifest();
  const escapedTemplateVariables = {
    machineModel: escapeTelegramHtml(machine),
    customerName: escapeTelegramHtml(customer),
    productType: escapeTelegramHtml(productType),
    serialNumber: escapeTelegramHtml(serial),
    sessionId: escapeTelegramHtml(handoff.sessionId),
    escalationReason: escapeTelegramHtml(handoff.escalationReason),
  };
  const renderedLeadLine = renderTemplate(
    intentManifest.communication.telegramEscalationNotificationText,
    escapedTemplateVariables
  ).trim();
  const fallbackLeadLine = `ESCALATION - ${escapeTelegramHtml(machine)}`;
  const sanitizedLeadLineHtml = sanitizeRichTextHtml(
    renderedLeadLine || fallbackLeadLine,
    "telegram"
  );
  const leadLineHasTags = /<[^>]+>/.test(sanitizedLeadLineHtml);
  const leadLine = leadLineHasTags
    ? sanitizedLeadLineHtml
    : `<b>${sanitizedLeadLineHtml || fallbackLeadLine}</b>`;

  const evidenceLines = Object.entries(handoff.evidenceCollected)
    .slice(0, 6)
    .map(([key, rec]) => {
      const keyLabel = escapeTelegramHtml(key.replaceAll("_", " "));
      const valueLabel = escapeTelegramHtml(String(rec.value ?? "unknown"));
      const confidenceLabel = escapeTelegramHtml(rec.confidence);
      return `- ${keyLabel}: ${valueLabel} (${confidenceLabel})`;
    });
  const messageLines = handoff.recentUserMessages
    .slice(-3)
    .map((entry) => `- ${escapeTelegramHtml(entry)}`);
  const attemptedLines = handoff.stepsAttempted
    .slice(0, 5)
    .map((step) => `- ${escapeTelegramHtml(step.instruction)}`);

  const summary = [
    leadLine,
    "",
    `<b>Customer:</b> ${escapeTelegramHtml(customer)}`,
    tel ? `<b>Phone:</b> <a href="tel:${escapeTelegramHtml(tel)}">${escapeTelegramHtml(phone)}</a>` : `<b>Phone:</b> ${escapeTelegramHtml(phone)}`,
    `<b>Machine:</b> ${escapeTelegramHtml(machine)}`,
    `<b>Serial:</b> ${escapeTelegramHtml(serial)}`,
    `<b>Product:</b> ${escapeTelegramHtml(productType)}`,
    `<b>Year:</b> ${escapeTelegramHtml(year)}`,
    "",
    `<b>Reason:</b> ${escapeTelegramHtml(handoff.escalationReason)}`,
    "",
    "<b>Evidence collected:</b>",
    evidenceLines.length > 0 ? evidenceLines.join("\n") : "- None",
    "",
    "<b>Recent messages:</b>",
    messageLines.length > 0 ? messageLines.join("\n") : "- None",
    "",
    "<b>Steps attempted:</b>",
    attemptedLines.length > 0 ? attemptedLines.join("\n") : "- None",
    "",
    handoff.ticketUrl
      ? `<b>Ticket:</b> <a href="${escapeTelegramHtml(handoff.ticketUrl)}">${escapeTelegramHtml(handoff.ticketUrl)}</a>`
      : `<b>Ticket ID:</b> ${escapeTelegramHtml(handoff.sessionId)}`,
  ].join("\n");

  const apiBase = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  let anySent = false;
  for (const chatId of allChatIds) {
    try {
      const messageResponse = await fetch(`${apiBase}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: summary,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (!messageResponse.ok) {
        console.error(`[escalation] Telegram sendMessage to ${chatId} failed: ${messageResponse.status} ${await messageResponse.text()}`);
        continue;
      }
      anySent = true;
    } catch (err) {
      console.error(`[escalation] Telegram sendMessage to ${chatId} failed:`, err instanceof Error ? err.message : err);
    }
  }

  const allImagePaths = Array.from(
    new Set([...handoff.clearanceImagePaths, ...handoff.userImagePaths])
  ).slice(0, 10);
  if (allImagePaths.length === 0) return anySent;

  const mediaEntries: Array<{ type: "photo"; media: string }> = [];
  const blobs: { key: string; blob: Blob; filename: string }[] = [];
  let attachmentIndex = 0;
  for (const imagePath of allImagePaths) {
    try {
      const data = await readStorageFile(imagePath);
      const key = `photo${attachmentIndex}`;
      mediaEntries.push({ type: "photo", media: `attach://${key}` });
      blobs.push({
        key,
        blob: new Blob([new Uint8Array(data)], { type: getImageContentType(imagePath) }),
        filename: imagePath.split("/").pop() || `${key}.jpg`,
      });
      attachmentIndex += 1;
    } catch (err) {
      console.error(`[escalation] Could not attach image ${imagePath}:`, err instanceof Error ? err.message : err);
    }
  }

  if (mediaEntries.length === 0) return anySent;
  for (const chatId of allChatIds) {
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("media", JSON.stringify(mediaEntries));
    for (const { key, blob, filename } of blobs) {
      formData.append(key, blob, filename);
    }
    try {
      const mediaResponse = await fetch(`${apiBase}/sendMediaGroup`, {
        method: "POST",
        body: formData,
      });
      if (!mediaResponse.ok) {
        console.error(`[escalation] Telegram sendMediaGroup to ${chatId} failed: ${mediaResponse.status} ${await mediaResponse.text()}`);
      } else {
        anySent = true;
      }
    } catch (err) {
      console.error(`[escalation] Telegram sendMediaGroup to ${chatId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return anySent;
}
