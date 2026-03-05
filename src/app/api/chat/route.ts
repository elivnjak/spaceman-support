import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-server";
import { db } from "@/lib/db";
import {
  diagnosticSessions,
  playbookProductTypes,
  playbooks,
  actions,
  labels,
  productTypes,
  nameplateConfig,
  nameplateGuideImages,
  clearanceConfig,
  clearanceGuideImages,
  diagnosisModeConfig,
} from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import { searchDocChunks } from "@/lib/pipeline/text-retrieval";
import {
  runDiagnosticPlanner,
  runFollowUpAnswer,
  validateAndSanitizePlannerOutput,
  checkEscalationTriggers,
  type DiagnosticPlaybook,
  type ChatMessage,
  type EvidenceRecord,
  type HypothesisState,
  type PlannerOutput,
  type ActionRecord,
} from "@/lib/pipeline/diagnostic-planner";
import {
  runSentimentClassifier,
  type SentimentSignal,
} from "@/lib/pipeline/sentiment-classifier";
import { getDiagnosticConfig, getTriageConfig } from "@/lib/config";
import { getIntentManifest } from "@/lib/intent/loader";
import {
  writeStorageFile,
  readStorageFile,
  diagnosticSessionImagePath,
} from "@/lib/storage";
import {
  buildEscalationHandoff,
  sendEscalationTelegram,
  sendEscalationWebhook,
} from "@/lib/escalation";
import { runPlaybookTriage, type TriageHistoryItem } from "@/lib/pipeline/playbook-triage";
import {
  analyzeNameplate,
  parseManufacturingYear,
  validateModel,
} from "@/lib/pipeline/nameplate-analysis";
import { AuditLogger } from "@/lib/audit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { logErrorEvent } from "@/lib/error-logs";
import { richTextToPlainText } from "@/lib/rich-text";

const STAGE_MESSAGES: Record<string, string> = {
  requesting_nameplate: "Collecting machine details…",
  requesting_clearance: "Collecting machine clearance photos…",
  selecting_playbook: "Selecting diagnostic guide…",
  asking_followup: "Asking a follow-up question…",
  analysing_photos: "Analysing your photos…",
  searching_manuals: "Searching knowledge base…",
  thinking: "Thinking…",
};
const VERIFICATION_REQUEST_ID = "_verification";
const VERIFICATION_REQUEST_OPTIONS = ["Yes, it's fixed", "No, still having issues"];
const ESCALATION_OFFER_REQUEST_ID = "_escalation_offer";
const SKIP_SIGNAL = "__skip__";
const DEFAULT_TECHNICAL_DIFFICULTIES_MESSAGE =
  "We're experiencing technical difficulties right now. I'm connecting you with a technician to continue helping you.";
const TECHNICAL_DIFFICULTIES_ESCALATION_REASON =
  "Technical difficulties while processing chat request.";
const DUPLICATE_TURN_WINDOW_MS = 5000;

const inFlightTurnKeys = new Set<string>();
const inFlightTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();
const IN_FLIGHT_TURN_KEY_TTL_MS = 15000;

type InputSource = "chat" | "structured" | "skip" | "note";
type DiagnosticSessionRow = typeof diagnosticSessions.$inferSelect;
type ReplayAssistantMessage = ChatMessage & {
  requests?: PlannerOutput["requests"];
  guideImages?: string[];
  resolution?: PlannerOutput["resolution"];
  escalation_reason?: string;
};

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

function buildVerificationRequest(
  promptText = "Did that fix the issue?"
): PlannerOutput["requests"][number] {
  return {
    type: "question",
    id: VERIFICATION_REQUEST_ID,
    prompt: promptText,
    expectedInput: {
      type: "boolean",
      options: [...VERIFICATION_REQUEST_OPTIONS],
    },
  };
}

function toPlainEscalationText(html: string, fallback: string): string {
  const plain = richTextToPlainText(html);
  return plain || fallback;
}

/** True if the error indicates the stream controller is already closed (e.g. client disconnected). */
function isControllerClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already closed|Invalid state/i.test(msg);
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: string) {
  try {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
  } catch (err) {
    if (!isControllerClosedError(err)) throw err;
    // Client likely disconnected; ignore so we don't log as a fatal error
  }
}

function closeController(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
  } catch (err) {
    if (!isControllerClosedError(err)) throw err;
  }
}

const KEEPALIVE_INTERVAL_MS = 8000;

/** Send an SSE comment to keep the connection alive (proxies often close idle connections after 15–60s). */
function sendKeepalive(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
  } catch (err) {
    if (!isControllerClosedError(err)) throw err;
  }
}

/** Run a long-running promise while sending keepalive comments so the stream isn't closed by timeouts. */
async function withKeepalive<T>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  promise: Promise<T>
): Promise<T> {
  const id = setInterval(() => sendKeepalive(controller), KEEPALIVE_INTERVAL_MS);
  try {
    return await promise;
  } finally {
    clearInterval(id);
  }
}

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Extract unique chunk IDs referenced in message text. Supports [uuid], [id: uuid], and (document uuid). */
function extractChunkIdsFromMessage(message: string): string[] {
  const ids = new Set<string>();
  const re = new RegExp(
    `(?:\\[(?:id:\\s*)?(${UUID_PATTERN})\\]|\\((?:document\\s+)?(${UUID_PATTERN})\\))`,
    "gi"
  );
  for (const m of message.matchAll(re)) {
    const id = (m[1] ?? m[2] ?? "").toLowerCase();
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Remove citation markers whose ID is not in the set of retrieved chunk IDs.
 * Prevents the LLM from showing "(document <uuid>)" or "[uuid]" for non-existent
 * documents when RAG is empty or the model hallucinates an ID.
 */
function stripInvalidCitationMarkers(
  message: string,
  validChunkIds: Set<string>
): string {
  if (validChunkIds.size === 0) {
    // No valid chunks: strip all citation-style UUIDs so we never show a fake doc ref
    const re = new RegExp(
      `\\s*\\[(?:id:\\s*)?${UUID_PATTERN}\\]|\\s*\\((?:document\\s+)?${UUID_PATTERN}\\)`,
      "gi"
    );
    return message.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  let out = message;
  const re = new RegExp(
    `(\\s*)(\\[(?:id:\\s*)?(${UUID_PATTERN})\\]|\\((?:document\\s+)?(${UUID_PATTERN})\\))`,
    "gi"
  );
  out = out.replace(re, (_, space, marker, id1, id2) => {
    const id = (id1 ?? id2 ?? "").toLowerCase();
    return validChunkIds.has(id) ? space + marker : space;
  });
  return out.replace(/\s{2,}/g, " ").trim();
}

export type CitationPayload = {
  chunkId: string;
  content: string;
  reason?: string;
  documentId?: string;
};

function buildCitations(
  message: string,
  chunks: { id: string; content: string; metadata?: unknown; documentId?: string }[]
): CitationPayload[] {
  const ids = extractChunkIdsFromMessage(message);
  const byId = new Map(chunks.map((c) => [c.id.toLowerCase(), c]));
  const citations: CitationPayload[] = [];
  for (const id of ids) {
    const chunk = byId.get(id);
    if (chunk)
      citations.push({
        chunkId: chunk.id,
        content: chunk.content,
        documentId: chunk.documentId,
      });
  }
  return citations;
}

/** Max length for user message to prevent token abuse. */
const MAX_MESSAGE_LENGTH = 4000;

const PLACEHOLDER_USER_MESSAGES = new Set(["(sent photos)", "sent photo(s)"]);
const TRIVIAL_USER_MESSAGE_PATTERNS = [
  /^(hi|hello|hey|heya|yo|sup|hola)[!.?]*$/i,
  /^(start|begin|help)[!.?]*$/i,
  /^(ok|okay|k|thanks|thank you)[!.?]*$/i,
];

function normalizeUserMessage(content: string): string {
  return content.trim().toLowerCase();
}

function buildTurnKey(sessionId: string, content: string, imageCount: number): string {
  return `${sessionId}::${normalizeUserMessage(content)}::${imageCount}`;
}

function acquireTurnKey(key: string): boolean {
  if (inFlightTurnKeys.has(key)) return false;
  inFlightTurnKeys.add(key);
  const existing = inFlightTurnTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    inFlightTurnKeys.delete(key);
    inFlightTurnTimers.delete(key);
  }, IN_FLIGHT_TURN_KEY_TTL_MS);
  inFlightTurnTimers.set(key, timer);
  return true;
}

function releaseTurnKey(key: string | null): void {
  if (!key) return;
  inFlightTurnKeys.delete(key);
  const timer = inFlightTurnTimers.get(key);
  if (timer) clearTimeout(timer);
  inFlightTurnTimers.delete(key);
}

function findRecentDuplicateAssistantReply(
  messages: ChatMessage[],
  incomingUserMessage: string,
  nowMs: number
): ReplayAssistantMessage | null {
  const normalizedIncoming = normalizeUserMessage(incomingUserMessage);
  if (!normalizedIncoming) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (normalizeUserMessage(msg.content) !== normalizedIncoming) continue;

    const ts = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
    if (!Number.isFinite(ts) || nowMs - ts > DUPLICATE_TURN_WINDOW_MS) return null;

    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j];
      if (next.role === "assistant") {
        return next as ReplayAssistantMessage;
      }
    }
    return null;
  }

  return null;
}

function isPlaceholderUserMessage(content: string): boolean {
  return PLACEHOLDER_USER_MESSAGES.has(normalizeUserMessage(content));
}

function isTrivialMessage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (isPlaceholderUserMessage(trimmed)) return true;
  return TRIVIAL_USER_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isSkipSignal(content: string): boolean {
  return normalizeUserMessage(content) === SKIP_SIGNAL;
}

/** True if the user is indicating they don't know / can't answer (should not force re-prompt). */
function isIdontKnowMessage(content: string): boolean {
  const n = normalizeUserMessage(content);
  if (!n || n === SKIP_SIGNAL) return true;
  const idkPatterns = [
    /^i don'?t know\.?$/i,
    /^dunno\.?$/i,
    /^(not sure|no idea|unsure|unknown|not certain)\.?$/i,
    /^i('m| am) not sure\.?$/i,
    /^can'?t (say|tell)\.?$/i,
  ];
  return idkPatterns.some((p) => p.test(n));
}

/** True if the user is indicating they don't have a photo (should not force re-prompt for photo). */
function isIdontHavePhotoMessage(content: string): boolean {
  const n = normalizeUserMessage(content);
  if (!n || n === SKIP_SIGNAL) return true;
  const noPhotoPatterns = [
    /^i don'?t have (a )?photo\.?$/i,
    /^i don'?t have (any )?(photos?|pictures?|images?)\.?$/i,
    /^(no photo|no photos|don'?t have (a )?photo)\.?$/i,
    /^i (don'?t have|haven'?t got) (one|any)\.?$/i,
    /^(unable to|can'?t) (provide|send|upload) (a )?photo\.?$/i,
  ];
  return noPhotoPatterns.some((p) => p.test(n));
}

function parseYesNoMessage(content: string): boolean | null {
  const n = normalizeUserMessage(content);
  if (!n) return null;
  const yesPatterns = [
    /^y(es|eah|ep)?\.?$/i,
    /^sure\.?$/i,
    /^i do\.?$/i,
    /^know both\.?$/i,
    /^yes[, ]+i know (them|both)\.?$/i,
  ];
  const noPatterns = [
    /^n(o|ope)?\.?$/i,
    /^nah\.?$/i,
    /^i don'?t\.?$/i,
    /^i don'?t know\.?$/i,
    /^i don'?t know (them|both)\.?$/i,
    /^not sure\.?$/i,
    /^no[, ]+i don'?t know (them|both)\.?$/i,
  ];
  if (yesPatterns.some((p) => p.test(n))) return true;
  if (noPatterns.some((p) => p.test(n))) return false;
  return null;
}

function countConsecutiveSkipTurns(messages: ChatMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const isExplicitIdk =
      msg.content.trim().length > 0 && isIdontKnowMessage(msg.content);
    if (isSkipSignal(msg.content) || isExplicitIdk) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function mapChecklistTypeToPlannerRequestType(
  type: "photo" | "reading" | "observation" | "action" | "confirmation"
): PlannerOutput["requests"][number]["type"] {
  if (type === "photo") return "photo";
  if (type === "reading") return "reading";
  if (type === "action") return "action";
  return "question";
}

function preventRepeatedChecklistRequests(input: {
  requests: PlannerOutput["requests"];
  playbook: DiagnosticPlaybook;
  evidence: Record<string, EvidenceRecord>;
  evidenceExtracted: PlannerOutput["evidence_extracted"];
  actionsById: Map<string, ActionRecord>;
}): {
  requests: PlannerOutput["requests"];
  removedRequestIds: string[];
  fallbackEvidenceId?: string;
} {
  const checklist = input.playbook.evidenceChecklist ?? [];
  if (!checklist.length || input.requests.length === 0) {
    return { requests: input.requests, removedRequestIds: [] };
  }

  const requestIdToEvidenceId = new Map<string, string>();
  for (const item of checklist) {
    requestIdToEvidenceId.set(item.id, item.id);
    if (item.actionId) requestIdToEvidenceId.set(item.actionId, item.id);
  }

  const effectiveEvidenceIds = new Set<string>(Object.keys(input.evidence));
  for (const extracted of input.evidenceExtracted) {
    if (extracted?.evidenceId) effectiveEvidenceIds.add(extracted.evidenceId);
  }

  const removedRequestIds: string[] = [];
  const filtered = input.requests.filter((req) => {
    const evidenceId = requestIdToEvidenceId.get(req.id);
    if (!evidenceId) {
      if (effectiveEvidenceIds.has(req.id)) {
        removedRequestIds.push(req.id);
        return false;
      }
      return true;
    }
    if (!effectiveEvidenceIds.has(evidenceId)) return true;
    removedRequestIds.push(req.id);
    return false;
  });

  if (filtered.length > 0) {
    return { requests: filtered, removedRequestIds };
  }

  const fallbackItem = checklist.find((item) => !effectiveEvidenceIds.has(item.id));
  if (!fallbackItem) {
    return { requests: filtered, removedRequestIds };
  }

  const mappedType = mapChecklistTypeToPlannerRequestType(fallbackItem.type);
  const linkedAction = fallbackItem.actionId
    ? input.actionsById.get(fallbackItem.actionId)
    : undefined;
  const actionExpectedInput =
    linkedAction?.expectedInput &&
    typeof linkedAction.expectedInput === "object"
      ? (linkedAction.expectedInput as PlannerOutput["requests"][number]["expectedInput"])
      : undefined;
  const expectedInput =
    fallbackItem.type === "confirmation"
      ? ({ type: "boolean", options: ["Yes", "No"] } as PlannerOutput["requests"][number]["expectedInput"])
      : actionExpectedInput;
  const photoSuffix =
    mappedType === "photo"
      ? " Please upload a clear, close-up photo with good lighting from 2 angles."
      : "";
  const fallbackRequest: PlannerOutput["requests"][number] = {
    type: mappedType,
    id: fallbackItem.actionId ?? fallbackItem.id,
    prompt: `${fallbackItem.description}${photoSuffix}`,
    ...(expectedInput ? { expectedInput } : {}),
  };

  return {
    requests: [fallbackRequest],
    removedRequestIds,
    fallbackEvidenceId: fallbackItem.id,
  };
}

function inferEvidenceFromOutstandingRequest(input: {
  message: string;
  outstandingRequestIds: string[];
  playbook: DiagnosticPlaybook;
}): PlannerOutput["evidence_extracted"] {
  if (input.outstandingRequestIds.length !== 1) return [];
  const requestId = input.outstandingRequestIds[0];
  if (!requestId) return [];

  const checklistItem = (input.playbook.evidenceChecklist ?? []).find(
    (item) => item.id === requestId || item.actionId === requestId
  );
  if (!checklistItem) return [];

  if (checklistItem.type === "confirmation") {
    const parsed = parseYesNoMessage(input.message);
    if (parsed === null) return [];
    return [
      {
        evidenceId: checklistItem.id,
        value: parsed,
        confidence: "exact",
      },
    ];
  }

  return [];
}

/** Pattern IDs that mean the user explicitly asked to speak to a human (not just frustration). */
const EXPLICIT_ASK_PATTERN_IDS = ["talk_to_human", "connect_or_escalate"];

function messageContainsEscalationIntent(
  content: string,
  patterns: string[]
): boolean {
  const normalized = normalizeUserMessage(content);
  if (!normalized) return false;
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(normalized);
    } catch {
      return false;
    }
  });
}

function messageExplicitlyAsksForHuman(
  content: string,
  detectionPatterns: { id: string; pattern: string }[]
): boolean {
  const explicitPatterns = detectionPatterns
    .filter((p) => EXPLICIT_ASK_PATTERN_IDS.includes(p.id))
    .map((p) => p.pattern);
  return messageContainsEscalationIntent(content, explicitPatterns);
}

function prependSubstantiveUserHistory(
  existing: TriageHistoryItem[],
  chatMessages: ChatMessage[]
): TriageHistoryItem[] {
  const existingUserEntries = new Set(
    existing
      .filter((item) => item.role === "user")
      .map((item) => normalizeUserMessage(item.content))
  );

  const toPrepend = chatMessages
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.content?.trim() ?? "")
    .filter((content) => content && !isPlaceholderUserMessage(content) && !isTrivialMessage(content))
    .filter((content) => !existingUserEntries.has(normalizeUserMessage(content)))
    .map((content) => ({ role: "user" as const, content }));

  return toPrepend.length > 0 ? [...toPrepend, ...existing] : existing;
}

async function getNameplatePrompt(): Promise<{ instructionText: string; guideImages: string[] }> {
  const [config] = await db.select().from(nameplateConfig).limit(1);
  const defaultInstruction =
    "Please take a clear photo of the machine name plate. It is usually on the rear or side panel and includes the model and serial number.";
  const instructionText = config?.instructionText?.trim() || defaultInstruction;

  const rawIds = Array.isArray(config?.guideImageIds) ? config.guideImageIds : [];
  const guideIds = rawIds
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);
  if (guideIds.length === 0) {
    return { instructionText, guideImages: [] };
  }

  const rows = await db
    .select({ id: nameplateGuideImages.id })
    .from(nameplateGuideImages)
    .where(inArray(nameplateGuideImages.id, guideIds));
  const rowIds = new Set(rows.map((row) => row.id));
  const guideImages = guideIds
    .filter((id) => rowIds.has(id))
    .map((id) => `/api/nameplate-guide-image/${id}`);
  return { instructionText, guideImages };
}

async function getClearancePrompt(): Promise<{ instructionText: string; guideImages: string[] }> {
  const [config] = await db.select().from(clearanceConfig).limit(1);
  const defaultInstruction =
    "Please send photos of machine clearance from different angles so our technical team can use them if escalation is needed.";
  const instructionText = config?.instructionText?.trim() || defaultInstruction;

  const rawIds = Array.isArray(config?.guideImageIds) ? config.guideImageIds : [];
  const guideIds = rawIds
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);
  if (guideIds.length === 0) {
    return { instructionText, guideImages: [] };
  }

  const rows = await db
    .select({ id: clearanceGuideImages.id })
    .from(clearanceGuideImages)
    .where(inArray(clearanceGuideImages.id, guideIds));
  const rowIds = new Set(rows.map((row) => row.id));
  const guideImages = guideIds
    .filter((id) => rowIds.has(id))
    .map((id) => `/api/clearance-guide-image/${id}`);
  return { instructionText, guideImages };
}

async function getProductTypeOptions(): Promise<{ name: string; isOther: boolean }[]> {
  const rows = await db
    .select({ name: productTypes.name, isOther: productTypes.isOther })
    .from(productTypes)
    .orderBy(asc(productTypes.sortOrder), asc(productTypes.name));
  if (rows.length > 0) {
    return rows;
  }
  return [
    { name: "Yogurt", isOther: false },
    { name: "Acai", isOther: false },
    { name: "Ice Cream", isOther: false },
    { name: "Other", isOther: true },
  ];
}

async function escalateOnTechnicalFailure(opts: {
  existingSession: DiagnosticSessionRow | null;
  sessionId: string | null;
  userName: string | null;
  userPhone: string | null;
  machineModel: string | null;
  playbookId: string | null;
  turnCount: number;
  messages: ChatMessage[];
  evidence: Record<string, EvidenceRecord>;
  hypotheses: HypothesisState[];
  technicalDifficultiesMessage: string;
  technicalDifficultiesMessageHtml: string;
}): Promise<{ sessionId: string; message: string; message_html: string; escalationReason: string }> {
  let resolvedSession = opts.existingSession;

  if (!resolvedSession && opts.sessionId) {
    resolvedSession = (
      await db
        .select()
        .from(diagnosticSessions)
        .where(eq(diagnosticSessions.id, opts.sessionId))
        .limit(1)
    )[0] ?? null;
  }

  const playbookLookupId = opts.playbookId ?? resolvedSession?.playbookId ?? null;
  const playbookRow = playbookLookupId
    ? (
      await db
        .select({ title: playbooks.title, labelId: playbooks.labelId })
        .from(playbooks)
        .where(eq(playbooks.id, playbookLookupId))
        .limit(1)
    )[0]
    : null;

  const mergedMessages = [...opts.messages];
  const lastMessage = mergedMessages[mergedMessages.length - 1];
  if (
    !lastMessage ||
    lastMessage.role !== "assistant" ||
    lastMessage.content !== opts.technicalDifficultiesMessage
  ) {
    mergedMessages.push({
      role: "assistant",
      content: opts.technicalDifficultiesMessage,
      content_html: opts.technicalDifficultiesMessageHtml,
      timestamp: new Date().toISOString(),
    });
  }

  if (!resolvedSession) {
    const [created] = await db
      .insert(diagnosticSessions)
      .values({
        status: "escalated",
        userName: opts.userName,
        userPhone: opts.userPhone,
        machineModel: opts.machineModel,
        playbookId: playbookLookupId,
        triageHistory: [],
        triageRound: 0,
        messages: mergedMessages,
        evidence: opts.evidence,
        hypotheses: opts.hypotheses,
        phase: "escalated",
        turnCount: opts.turnCount,
        escalationReason: TECHNICAL_DIFFICULTIES_ESCALATION_REASON,
      })
      .returning();
    resolvedSession = created;
  }

  const evidenceForHandoff =
    Object.keys(opts.evidence).length > 0
      ? opts.evidence
      : ((resolvedSession.evidence as Record<string, EvidenceRecord>) ?? {});
  const hypothesesForHandoff =
    opts.hypotheses.length > 0
      ? opts.hypotheses
      : ((resolvedSession.hypotheses as HypothesisState[]) ?? []);

  const escalationHandoff = buildEscalationHandoff({
    sessionId: resolvedSession.id,
    userName: resolvedSession.userName ?? opts.userName,
    userPhone: resolvedSession.userPhone ?? opts.userPhone,
    machineModel: resolvedSession.machineModel ?? opts.machineModel,
    serialNumber: resolvedSession.serialNumber ?? null,
    productType: resolvedSession.productType ?? null,
    manufacturingYear: resolvedSession.manufacturingYear ?? null,
    clearanceImagePaths: resolvedSession.clearanceImagePaths ?? [],
    escalationReason: TECHNICAL_DIFFICULTIES_ESCALATION_REASON,
    playbookTitle: playbookRow?.title ?? "Technical failure",
    labelId: playbookRow?.labelId ?? "system_error",
    turnCount: Math.max(opts.turnCount, resolvedSession.turnCount ?? 0),
    evidence: evidenceForHandoff,
    hypotheses: hypothesesForHandoff,
    messages: mergedMessages,
  });

  await db
    .update(diagnosticSessions)
    .set({
      messages: mergedMessages,
      phase: "escalated",
      status: "escalated",
      escalationReason: TECHNICAL_DIFFICULTIES_ESCALATION_REASON,
      escalationHandoff,
      updatedAt: new Date(),
    })
    .where(eq(diagnosticSessions.id, resolvedSession.id));

  sendEscalationWebhook(escalationHandoff).catch(() => {});
  sendEscalationTelegram(escalationHandoff).catch(() => {});

  return {
    sessionId: resolvedSession.id,
    message: opts.technicalDifficultiesMessage,
    message_html: opts.technicalDifficultiesMessageHtml,
    escalationReason: TECHNICAL_DIFFICULTIES_ESCALATION_REASON,
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const sessionIdRaw = (formData.get("sessionId") as string)?.trim() || null;
  const turnstileToken = (formData.get("cf-turnstile-response") as string)?.trim() || null;
  const message = (formData.get("message") as string)?.trim() ?? "";
  const inputSourceRaw = (formData.get("inputSource") as string)?.trim().toLowerCase() ?? "";
  const inputSource: InputSource =
    inputSourceRaw === "structured" ||
    inputSourceRaw === "skip" ||
    inputSourceRaw === "note"
      ? inputSourceRaw
      : "chat";
  const machineModel = (formData.get("machineModel") as string)?.trim() || null;
  const userName = (formData.get("userName") as string)?.trim() || null;
  const userPhone = (formData.get("userPhone") as string)?.trim() || null;
  const files = formData.getAll("images") as File[];

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message must be at most ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const authSession = await getSessionFromRequest(request);
  const isAuthenticated = Boolean(authSession);
  const isAdmin = authSession?.user?.role === "admin";
  const isNewSessionRequest = !sessionIdRaw;

  if (isNewSessionRequest && (!userName || !userPhone)) {
    return NextResponse.json(
      { error: "Name and phone number are required to start a new chat." },
      { status: 400 }
    );
  }

  if (isNewSessionRequest && !isAdmin) {
    const verification = await verifyTurnstileToken({
      token: turnstileToken,
      remoteIp: getClientIp(request),
    });
    if (!verification.ok) {
      await logErrorEvent({
        level: "warn",
        route: "/api/chat",
        sessionId: null,
        message: "Turnstile verification failed for new public chat session.",
        context: {
          hasToken: Boolean(turnstileToken),
          errorCodes: verification.errorCodes,
          isAuthenticated,
          isAdmin,
        },
      }).catch(() => {});
      return NextResponse.json(
        { error: "Verification failed. Please refresh and try again." },
        { status: 403 }
      );
    }
  }

  // Per-session rate limit (skip when admin is logged in, e.g. for testing)
  if (sessionIdRaw && !isAdmin) {
    const { chatPerSession } = RATE_LIMITS;
    const result = await checkRateLimit(
      `session:${sessionIdRaw}`,
      chatPerSession.maxRequests,
      chatPerSession.windowMs
    );
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(result.resetMs / 1000)),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
  }

  const imageBuffers: Buffer[] = [];
  for (const file of files) {
    if (file && file.size > 0) {
      imageBuffers.push(Buffer.from(await file.arrayBuffer()));
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      let audit: AuditLogger | null = null;
      let turnKeyForRelease: string | null = null;
      let sessionForError: DiagnosticSessionRow | null = null;
      let sessionIdForError: string | null = sessionIdRaw;
      let messagesForError: ChatMessage[] = [];
      let evidenceForError: Record<string, EvidenceRecord> = {};
      let hypothesesForError: HypothesisState[] = [];
      let turnCountForError = 0;
      let playbookIdForError: string | null = null;
      let machineModelForError: string | null = machineModel;
      let technicalDifficultiesMessage = DEFAULT_TECHNICAL_DIFFICULTIES_MESSAGE;
      let technicalDifficultiesMessageHtml = DEFAULT_TECHNICAL_DIFFICULTIES_MESSAGE;
      const sendEvent = (
        ...args:
          | [string, string]
          | [ReadableStreamDefaultController<Uint8Array>, string, string]
      ) => {
        const event = args.length === 3 ? args[1] : args[0];
        const data = args.length === 3 ? args[2] : args[1];
        let safeData = data;
        if (!isAuthenticated && event === "message") {
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (parsed && typeof parsed === "object" && "escalation_reason" in parsed) {
              delete parsed.escalation_reason;
              safeData = JSON.stringify(parsed);
            }
          } catch {
            // Keep original payload if it's not JSON
          }
        }
        if (event === "message") {
          try {
            audit?.logApiResponse(JSON.parse(safeData));
          } catch {
            audit?.logApiResponse(safeData);
          }
        }
        send(controller, event, safeData);
      };
      try {
        const [diagnosticConfig, triageConfig, intentManifest, diagnosisModeRow] =
          await Promise.all([
            getDiagnosticConfig(),
            getTriageConfig(),
            getIntentManifest(),
            db
              .select()
              .from(diagnosisModeConfig)
              .limit(1)
              .then((rows) => rows[0] ?? null),
          ]);
        const diagnosisModeEnabled = isAuthenticated ? true : (diagnosisModeRow?.enabled ?? true);
        const shouldBypassDiagnosis = !diagnosisModeEnabled;
        const generalEscalationMessageHtml = intentManifest.communication.escalationTone;
        const generalEscalationMessage = toPlainEscalationText(
          generalEscalationMessageHtml,
          "I'm connecting you with a technician now."
        );
        const frustrationEscalationMessageHtml =
          intentManifest.frustrationHandling.escalationIntentMessage;
        const frustrationEscalationMessage = toPlainEscalationText(
          frustrationEscalationMessageHtml,
          "I understand this is frustrating. I can connect you with a technician now."
        );
        const noModelNumberEscalationMessageHtml =
          intentManifest.communication.noModelNumberEscalationMessage;
        const noModelNumberEscalationMessage = toPlainEscalationText(
          noModelNumberEscalationMessageHtml,
          "Since we don't have the machine model/serial details, I'm connecting you with a technician to continue."
        );
        technicalDifficultiesMessageHtml =
          intentManifest.communication.technicalDifficultiesEscalationMessage;
        technicalDifficultiesMessage = toPlainEscalationText(
          technicalDifficultiesMessageHtml,
          DEFAULT_TECHNICAL_DIFFICULTIES_MESSAGE
        );
        const frustrationPatterns =
          intentManifest.frustrationHandling.detectionPatterns.map(
            (item) => item.pattern
          );
        let session = sessionIdRaw
          ? (await db.select().from(diagnosticSessions).where(eq(diagnosticSessions.id, sessionIdRaw)))[0]
          : null;

        const isNewSession = !session;
        let sessionId: string;

        if (isNewSession) {
          const [created] = await db
            .insert(diagnosticSessions)
            .values({
              status: "active",
              userName,
              userPhone,
              machineModel: null,
              playbookId: null,
              triageHistory: [],
              triageRound: 0,
              messages: [],
              evidence: {},
              hypotheses: [],
              phase: "collecting_issue",
              turnCount: 0,
            })
            .returning();
          session = created;
          sessionId = session.id;
        } else {
          if (!session) {
            throw new Error("Session not found.");
          }
          sessionId = session.id;
        }
        sessionForError = session;
        sessionIdForError = sessionId;

        if (sessionId && message) {
          const turnKey = buildTurnKey(sessionId, message, imageBuffers.length);
          turnKeyForRelease = turnKey;
          if (!acquireTurnKey(turnKey)) {
            const latestAssistant = [...((session.messages as ChatMessage[]) ?? [])]
              .reverse()
              .find((m) => m.role === "assistant") as ReplayAssistantMessage | undefined;
            if (latestAssistant) {
              sendEvent(
                "message",
                JSON.stringify({
                  sessionId,
                  message: latestAssistant.content,
                  message_html: latestAssistant.content_html,
                  phase: session.phase ?? "collecting_issue",
                  requests: latestAssistant.requests,
                  resolution: latestAssistant.resolution,
                  escalation_reason: latestAssistant.escalation_reason,
                  guideImages: latestAssistant.guideImages,
                })
              );
            } else {
              sendEvent("error", JSON.stringify({ error: "A similar request is already being processed." }));
            }
            closeController(controller);
            return;
          }
        }

        machineModelForError = session.machineModel ?? machineModel;
        playbookIdForError = session.playbookId ?? null;
        turnCountForError = session.turnCount ?? 0;

        audit = new AuditLogger(sessionId, (session.turnCount ?? 0) + 1);
        audit.logSessionState("before", {
          phase: session.phase,
          turnCount: session.turnCount ?? 0,
          status: session.status,
          machineModel: session.machineModel,
          playbookId: session.playbookId,
          evidenceKeys: Object.keys((session.evidence as Record<string, unknown>) ?? {}),
          hypothesesCount: ((session.hypotheses as unknown[]) ?? []).length,
        });

        const messages = (session!.messages as ChatMessage[]) ?? [];
        messagesForError = messages;
        let imageBuffersForLlm = imageBuffers;
        let triageHistory = (session!.triageHistory as TriageHistoryItem[] | null) ?? [];
        let triageRound = session!.triageRound ?? 0;
        const imagePaths: string[] = [];
        if (imageBuffers.length > 0 && sessionId) {
          for (let i = 0; i < imageBuffers.length; i++) {
            const relPath = diagnosticSessionImagePath(
              sessionId,
              `turn_${messages.length / 2}_${i}.jpg`
            );
            await writeStorageFile(relPath, imageBuffers[i]);
            imagePaths.push(relPath);
          }
        }

        const hasUserInput = Boolean(message) || imagePaths.length > 0;
        const incomingUserMessage = message || "(sent photos)";
        if (sessionId && hasUserInput && imagePaths.length === 0) {
          const duplicateReply = findRecentDuplicateAssistantReply(
            messages,
            incomingUserMessage,
            Date.now()
          );
          if (duplicateReply) {
            sendEvent(
              "message",
              JSON.stringify({
                sessionId,
                message: duplicateReply.content,
                message_html: duplicateReply.content_html,
                phase: session.phase ?? "collecting_issue",
                requests: duplicateReply.requests,
                resolution: duplicateReply.resolution,
                escalation_reason: duplicateReply.escalation_reason,
                guideImages: duplicateReply.guideImages,
              })
            );
            closeController(controller);
            return;
          }
        }
        audit.logUserInput({
          message: message || "",
          imageCount: imageBuffers.length,
          imageSizes: imageBuffers.map((buf) => buf.length),
          imagePaths,
        });
        if (hasUserInput) {
          messages.push({
            role: "user",
            content: message || "(sent photos)",
            images: imagePaths.length ? imagePaths : undefined,
            timestamp: new Date().toISOString(),
          });
        }

        if (session.phase === "collecting_issue") {
          audit.logPhasePath("collecting_issue");
          const { instructionText, guideImages } = await getNameplatePrompt();
          const hasSubstantiveIssue =
            Boolean(message) &&
            !isPlaceholderUserMessage(message) &&
            !isTrivialMessage(message);
          const userExplicitlyAskedForHuman =
            Boolean(message) &&
            messageExplicitlyAsksForHuman(
              message,
              intentManifest.frustrationHandling.detectionPatterns
            );

          if (userExplicitlyAskedForHuman) {
            const escalationReason = "User asked to speak with a human";
            const escalationMessage = frustrationEscalationMessage;
            messages.push({
              role: "assistant",
              content: escalationMessage,
              content_html: frustrationEscalationMessageHtml,
              timestamp: new Date().toISOString(),
            });
            const evidence = (session.evidence as Record<string, unknown>) ?? {};
            const hypotheses = (session.hypotheses as unknown[]) ?? [];
            const escalationHandoff = buildEscalationHandoff({
              sessionId,
              userName: session.userName ?? null,
              userPhone: session.userPhone ?? null,
              machineModel: session.machineModel ?? null,
              serialNumber: session.serialNumber ?? null,
              productType: session.productType ?? null,
              manufacturingYear: session.manufacturingYear ?? null,
              clearanceImagePaths: session.clearanceImagePaths ?? [],
              escalationReason,
              playbookTitle: "Pre-diagnosis",
              labelId: "collecting_issue_human_request",
              turnCount: session.turnCount ?? 0,
              evidence: evidence as Parameters<typeof buildEscalationHandoff>[0]["evidence"],
              hypotheses: hypotheses as Parameters<typeof buildEscalationHandoff>[0]["hypotheses"],
              messages,
            });

            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "escalated",
                status: "escalated",
                escalationReason,
                escalationHandoff,
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: escalationMessage,
                message_html: frustrationEscalationMessageHtml,
                phase: "escalated",
                requests: [],
                escalation_reason: escalationReason,
              })
            );
            sendEscalationWebhook(escalationHandoff).catch(() => {});
            sendEscalationTelegram(escalationHandoff).catch(() => {});
            closeController(controller);
            return;
          }

          if (hasSubstantiveIssue) {
            if (!intentManifest.safety.requireNameplate && diagnosisModeEnabled) {
              const availableProductTypes = await getProductTypeOptions();
              const productTypeOptions = availableProductTypes.map(
                (item) => item.name
              );
              const responseMessage =
                "Before we continue, what type of product are you using? If you choose Other, please specify the exact product.";
              const assistantTurn: ChatMessage & {
                requests?: PlannerOutput["requests"];
              } = {
                role: "assistant",
                content: responseMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "question",
                    id: "product_type",
                    prompt: "What type of product are you using?",
                    expectedInput: { type: "enum", options: productTypeOptions },
                  },
                ],
              };
              messages.push(assistantTurn);
              triageHistory = [
                ...triageHistory,
                { role: "user", content: message.trim() },
              ];
              await db
                .update(diagnosticSessions)
                .set({
                  messages,
                  triageHistory,
                  phase: "product_type_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));
              sendEvent(
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "product_type_check",
                  requests: assistantTurn.requests,
                })
              );
              closeController(controller);
              return;
            }
            console.log(
              `[chat] phase: collecting_issue -> nameplate_check (session=${sessionId}) symptom="${message.trim().slice(0, 60)}${message.length > 60 ? "…" : ""}"`
            );
            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_nameplate }));
            const responseMessage = `Thanks. ${instructionText}`;
            const assistantTurn: ChatMessage & {
              requests?: PlannerOutput["requests"];
              guideImages?: string[];
            } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "photo",
                  id: "nameplate_photo",
                  prompt: "Please upload a clear photo of the machine name plate.",
                  expectedInput: { type: "photo" },
                },
              ],
              guideImages: guideImages.length > 0 ? guideImages : undefined,
            };
            messages.push(assistantTurn);
            triageHistory = [...triageHistory, { role: "user", content: message.trim() }];

            await db
              .update(diagnosticSessions)
              .set({
                messages,
                triageHistory,
                phase: "nameplate_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            session = {
              ...session,
              triageHistory,
              phase: "nameplate_check",
              status: "active",
            };

            sendEvent(
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "nameplate_check",
                requests: assistantTurn.requests,
                guideImages: guideImages.length > 0 ? guideImages : undefined,
              })
            );
            closeController(controller);
            return;
          }

          if (imageBuffers.length > 0) {
            console.log(
              `[chat] phase: collecting_issue -> nameplate_check (session=${sessionId}) photo-only, no substantive text`
            );
            await db
              .update(diagnosticSessions)
              .set({
                phase: "nameplate_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            session = {
              ...session,
              phase: "nameplate_check",
              status: "active",
            };
          } else {
            console.log(
              `[chat] phase: collecting_issue (stay) (session=${sessionId}) trivial/empty message, asking for issue`
            );
            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.asking_followup }));
            const responseMessage = "What issue are you experiencing with the machine?";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "issue_description",
                  prompt: responseMessage,
                  expectedInput: { type: "text" },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "collecting_issue",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "collecting_issue",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }
        }

        if (session.phase === "nameplate_check") {
          audit.logPhasePath("nameplate_check");
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_nameplate }));
          const { instructionText, guideImages } = await getNameplatePrompt();
          const activeSession = session;
          const previousAssistantMessage = [...messages]
            .reverse()
            .find((entry) => entry.role === "assistant") as
            | (ChatMessage & { requests?: PlannerOutput["requests"] })
            | undefined;
          const pendingRequestIds = new Set(
            (previousAssistantMessage?.requests ?? []).map((request) => request.id)
          );
          const awaitingManualAvailability = pendingRequestIds.has("nameplate_manual_known");
          const awaitingManualModel = pendingRequestIds.has("nameplate_manual_model");
          const awaitingManualSerial =
            pendingRequestIds.has("nameplate_manual_serial") ||
            pendingRequestIds.has("nameplate_manual_serial_retry");
          const isManualSerialRetry = pendingRequestIds.has("nameplate_manual_serial_retry");
          const unsupportedMessage =
            `Your machine isn't a ${intentManifest.safety.supportedBrand} machine. We only support ${intentManifest.safety.supportedBrand} machines.`;

          const escalateFromNameplate = async (
            escalationMessage: string,
            escalationReason: string,
            labelId: string,
            escalationMessageHtml?: string
          ) => {
            messages.push({
              role: "assistant",
              content: escalationMessage,
              content_html: escalationMessageHtml,
              timestamp: new Date().toISOString(),
            });
            const evidence = (activeSession.evidence as Record<string, unknown>) ?? {};
            const hypotheses = (activeSession.hypotheses as unknown[]) ?? [];
            const escalationHandoff = buildEscalationHandoff({
              sessionId,
              userName: activeSession.userName ?? null,
              userPhone: activeSession.userPhone ?? null,
              machineModel: activeSession.machineModel ?? null,
              serialNumber: activeSession.serialNumber ?? null,
              productType: activeSession.productType ?? null,
              manufacturingYear: activeSession.manufacturingYear ?? null,
              clearanceImagePaths: activeSession.clearanceImagePaths ?? [],
              escalationReason,
              playbookTitle: "Pre-diagnosis",
              labelId,
              turnCount: activeSession.turnCount ?? 0,
              evidence: evidence as Parameters<typeof buildEscalationHandoff>[0]["evidence"],
              hypotheses: hypotheses as Parameters<typeof buildEscalationHandoff>[0]["hypotheses"],
              messages,
            });
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "escalated",
                status: "escalated",
                escalationReason,
                escalationHandoff: escalationHandoff,
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: escalationMessage,
                message_html: escalationMessageHtml,
                phase: "escalated",
                requests: [],
                escalation_reason: escalationReason,
              })
            );
            sendEscalationWebhook(escalationHandoff).catch(() => {});
            sendEscalationTelegram(escalationHandoff).catch(() => {});
            closeController(controller);
          };

          const finalizeNameplateDetails = async (
            extractedModelInput: string,
            extractedSerialInput: string,
            source: "photo" | "manual",
            manualRetry = false
          ) => {
            const extractedModel = extractedModelInput.trim();
            const extractedSerial = extractedSerialInput.trim();
            const { valid, canonical } = await validateModel(extractedModel);
            if (!valid) {
              messages.push({
                role: "assistant",
                content: unsupportedMessage,
                timestamp: new Date().toISOString(),
              });
              await db
                .update(diagnosticSessions)
                .set({
                  machineModel: canonical || extractedModel,
                  serialNumber: extractedSerial,
                  messages,
                  phase: "unsupported_model",
                  status: "resolved",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: unsupportedMessage,
                  phase: "unsupported_model",
                  requests: [],
                })
              );
              closeController(controller);
              return;
            }

            const manufacturingYear = parseManufacturingYear(extractedSerial);
            if (manufacturingYear == null) {
              if (source === "manual") {
                if (manualRetry) {
                  await escalateFromNameplate(
                    "I still can't determine the machine age from that serial number. I'm connecting you with a technician to continue.",
                    "Could not determine machine age from manually provided serial number.",
                    "nameplate_manual_serial_unreadable"
                  );
                  return;
                }
                const retrySerialMessage =
                  "I couldn't determine the manufacturing year from that serial number. Please re-enter the full serial number exactly as shown on the machine.";
                const assistantTurn: ChatMessage & {
                  requests?: PlannerOutput["requests"];
                } = {
                  role: "assistant",
                  content: retrySerialMessage,
                  timestamp: new Date().toISOString(),
                  requests: [
                    {
                      type: "question",
                      id: "nameplate_manual_serial_retry",
                      prompt: "Please re-enter the machine serial number.",
                      expectedInput: { type: "text" },
                    },
                  ],
                };
                messages.push(assistantTurn);
                await db
                  .update(diagnosticSessions)
                  .set({
                    machineModel: canonical,
                    serialNumber: extractedSerial,
                    messages,
                    phase: "nameplate_check",
                    status: "active",
                    updatedAt: new Date(),
                  })
                  .where(eq(diagnosticSessions.id, sessionId));

                sendEvent(
                  controller,
                  "message",
                  JSON.stringify({
                    sessionId,
                    message: retrySerialMessage,
                    phase: "nameplate_check",
                    requests: assistantTurn.requests,
                  })
                );
                closeController(controller);
                return;
              }
              const retrySerialMessage =
                "I found the serial number but couldn't read its manufacturing year. Please upload a clearer name plate photo where the serial is fully visible.";
              const assistantTurn: ChatMessage & {
                requests?: PlannerOutput["requests"];
                guideImages?: string[];
              } = {
                role: "assistant",
                content: retrySerialMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "photo",
                    id: "nameplate_serial_retry",
                    prompt: "Please upload a clearer photo of the serial number on the name plate.",
                    expectedInput: { type: "photo" },
                  },
                ],
                guideImages: guideImages.length > 0 ? guideImages : undefined,
              };
              messages.push(assistantTurn);
              await db
                .update(diagnosticSessions)
                .set({
                  machineModel: canonical,
                  serialNumber: extractedSerial,
                  messages,
                  phase: "nameplate_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: retrySerialMessage,
                  phase: "nameplate_check",
                  requests: assistantTurn.requests,
                  guideImages: guideImages.length > 0 ? guideImages : undefined,
                })
              );
              closeController(controller);
              return;
            }

            const currentYear = new Date().getFullYear();
            const isOlderThanFiveYears =
              currentYear - manufacturingYear >
              intentManifest.safety.machineAgeThresholdYears;
            if (isOlderThanFiveYears) {
              const escalationMessage =
                `This machine appears to be more than ${intentManifest.safety.machineAgeThresholdYears} years old, so I'm connecting you with a technical specialist.`;
              messages.push({
                role: "assistant",
                content: escalationMessage,
                timestamp: new Date().toISOString(),
              });
              await db
                .update(diagnosticSessions)
                .set({
                  machineModel: canonical,
                  serialNumber: extractedSerial,
                  manufacturingYear,
                  messages,
                  phase: "escalated",
                  status: "escalated",
                  escalationReason: `Machine is more than ${intentManifest.safety.machineAgeThresholdYears} years old based on serial number.`,
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: escalationMessage,
                  phase: "escalated",
                  requests: [],
                  escalation_reason: `Machine is more than ${intentManifest.safety.machineAgeThresholdYears} years old based on serial number.`,
                })
              );
              closeController(controller);
              return;
            }

            if (shouldBypassDiagnosis) {
              const { instructionText, guideImages: clearanceGuideImages } = await getClearancePrompt();
              const responseMessage = `Thanks. ${instructionText}`;
              const assistantTurn: ChatMessage & {
                requests?: PlannerOutput["requests"];
                guideImages?: string[];
              } = {
                role: "assistant",
                content: responseMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "photo",
                    id: "clearance_photos",
                    prompt: "Please upload machine clearance photos from different angles.",
                    expectedInput: { type: "photo" },
                  },
                ],
                guideImages: clearanceGuideImages.length > 0 ? clearanceGuideImages : undefined,
              };
              messages.push(assistantTurn);

              await db
                .update(diagnosticSessions)
                .set({
                  machineModel: canonical,
                  serialNumber: extractedSerial,
                  manufacturingYear,
                  messages,
                  phase: "clearance_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "clearance_check",
                  requests: assistantTurn.requests,
                  guideImages: clearanceGuideImages.length > 0 ? clearanceGuideImages : undefined,
                })
              );
              closeController(controller);
              return;
            }

            triageHistory = prependSubstantiveUserHistory(triageHistory, messages);
            const triagePreview = triageHistory
              .filter((h) => h.role === "user")
              .map((h) => h.content.slice(0, 40))
              .join(" | ");
            console.log(
              `[chat] phase: nameplate_check -> product_type_check (session=${sessionId}) triageHistory items=${triageHistory.length} user_preview="${triagePreview}${triagePreview.length >= 80 ? "…" : ""}"`
            );
            const availableProductTypes = await getProductTypeOptions();
            const productTypeOptions = availableProductTypes.map((item) => item.name);
            const responseMessage =
              "Before we continue, what type of product are you using? If you choose Other, please specify the exact product.";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "product_type",
                  prompt: "What type of product are you using?",
                  expectedInput: { type: "enum", options: productTypeOptions },
                },
              ],
            };
            messages.push(assistantTurn);

            await db
              .update(diagnosticSessions)
              .set({
                machineModel: canonical,
                serialNumber: extractedSerial,
                manufacturingYear,
                triageHistory,
                messages,
                phase: "product_type_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "product_type_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
          };

          if (imageBuffers.length === 0 && awaitingManualAvailability) {
            const knowsManualDetails = isIdontKnowMessage(message)
              ? false
              : parseYesNoMessage(message);
            if (knowsManualDetails == null) {
              const responseMessage =
                "If you don't have a photo, do you know both the machine model and serial number so you can enter them manually?";
              const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
                role: "assistant",
                content: responseMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "question",
                    id: "nameplate_manual_known",
                    prompt: "Do you know both the machine model and serial number?",
                    expectedInput: {
                      type: "enum",
                      options: ["Yes, I know both", "No, I don't know them"],
                    },
                  },
                ],
              };
              messages.push(assistantTurn);
              await db
                .update(diagnosticSessions)
                .set({
                  messages,
                  phase: "nameplate_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));
              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "nameplate_check",
                  requests: assistantTurn.requests,
                })
              );
              closeController(controller);
              return;
            }

            if (!knowsManualDetails) {
              await escalateFromNameplate(
                noModelNumberEscalationMessage,
                "User does not have a photo of the machine name plate and cannot provide model/serial manually.",
                "nameplate_manual_unknown",
                noModelNumberEscalationMessageHtml
              );
              return;
            }

            const responseMessage = "Great. Please enter the machine model number.";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "nameplate_manual_model",
                  prompt: "Enter the machine model number.",
                  expectedInput: { type: "text" },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "nameplate_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "nameplate_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }

          if (imageBuffers.length === 0 && awaitingManualModel) {
            const enteredModel = message.trim();
            if (!enteredModel || isIdontKnowMessage(message)) {
              await escalateFromNameplate(
                noModelNumberEscalationMessage,
                "User could not provide machine model during manual nameplate entry.",
                "nameplate_manual_model_missing",
                noModelNumberEscalationMessageHtml
              );
              return;
            }
            const responseMessage = "Thanks. Please enter the machine serial number.";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "nameplate_manual_serial",
                  prompt: "Enter the machine serial number.",
                  expectedInput: { type: "text" },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                machineModel: enteredModel,
                messages,
                phase: "nameplate_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "nameplate_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }

          if (imageBuffers.length === 0 && awaitingManualSerial) {
            const enteredSerial = message.trim();
            const enteredModel = (activeSession.machineModel ?? "").trim();
            if (!enteredSerial || isIdontKnowMessage(message)) {
              await escalateFromNameplate(
                noModelNumberEscalationMessage,
                "User could not provide machine serial during manual nameplate entry.",
                "nameplate_manual_serial_missing",
                noModelNumberEscalationMessageHtml
              );
              return;
            }
            if (!enteredModel) {
              const responseMessage = "Please enter the machine model number first.";
              const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
                role: "assistant",
                content: responseMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "question",
                    id: "nameplate_manual_model",
                    prompt: "Enter the machine model number.",
                    expectedInput: { type: "text" },
                  },
                ],
              };
              messages.push(assistantTurn);
              await db
                .update(diagnosticSessions)
                .set({
                  messages,
                  phase: "nameplate_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));
              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "nameplate_check",
                  requests: assistantTurn.requests,
                })
              );
              closeController(controller);
              return;
            }

            await finalizeNameplateDetails(
              enteredModel,
              enteredSerial,
              "manual",
              isManualSerialRetry
            );
            return;
          }

          if (
            imageBuffers.length === 0 &&
            (isSkipSignal(message) || isIdontHavePhotoMessage(message))
          ) {
            const responseMessage =
              "No problem if you don't have a photo. Do you know both the machine model and serial number so you can enter them manually?";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "nameplate_manual_known",
                  prompt: "Do you know both the machine model and serial number?",
                  expectedInput: {
                    type: "enum",
                    options: ["Yes, I know both", "No, I don't know them"],
                  },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                machineModel: machineModel ?? session.machineModel ?? null,
                messages,
                phase: "nameplate_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "nameplate_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }

          if (imageBuffers.length === 0) {
            const responseMessage = instructionText;
            const assistantTurn: ChatMessage & {
              requests?: PlannerOutput["requests"];
              guideImages?: string[];
            } = {
              role: "assistant",
              content: responseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "photo",
                  id: "nameplate_photo",
                  prompt: "Please upload a clear photo of the machine name plate.",
                  expectedInput: { type: "photo" },
                },
              ],
              guideImages: guideImages.length > 0 ? guideImages : undefined,
            };
            messages.push(assistantTurn);

            await db
              .update(diagnosticSessions)
              .set({
                machineModel: machineModel ?? session.machineModel ?? null,
                messages,
                phase: "nameplate_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "nameplate_check",
                requests: assistantTurn.requests,
                guideImages: guideImages.length > 0 ? guideImages : undefined,
              })
            );
            closeController(controller);
            return;
          }

          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.analysing_photos }));

          try {
            const extracted = await withKeepalive(
              controller,
              analyzeNameplate(imageBuffers, audit)
            );
            const extractedModel = extracted.modelNumber?.trim() ?? "";
            const extractedSerial = extracted.serialNumber?.trim() ?? "";

            if (!extractedModel || !extractedSerial) {
              const retryMessage =
                "I couldn't reliably read the model and serial number from that photo. Please upload a sharper photo of the full name plate.";
              const assistantTurn: ChatMessage & {
                requests?: PlannerOutput["requests"];
                guideImages?: string[];
              } = {
                role: "assistant",
                content: retryMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "photo",
                    id: "nameplate_photo_retry",
                    prompt: "Please upload another clear photo of the full name plate.",
                    expectedInput: { type: "photo" },
                  },
                ],
                guideImages: guideImages.length > 0 ? guideImages : undefined,
              };
              messages.push(assistantTurn);
              await db
                .update(diagnosticSessions)
                .set({
                  messages,
                  phase: "nameplate_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: retryMessage,
                  phase: "nameplate_check",
                  requests: assistantTurn.requests,
                  guideImages: guideImages.length > 0 ? guideImages : undefined,
                })
              );
              closeController(controller);
              return;
            }

            await finalizeNameplateDetails(extractedModel, extractedSerial, "photo");
            return;
          } catch {
            messages.push({
              role: "assistant",
              content: unsupportedMessage,
              timestamp: new Date().toISOString(),
            });
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "unsupported_model",
                status: "resolved",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: unsupportedMessage,
                phase: "unsupported_model",
                requests: [],
              })
            );
            closeController(controller);
            return;
          }
        }

        if (session.phase === "product_type_check") {
          audit.logPhasePath("product_type_check");
          const availableProductTypes = await getProductTypeOptions();
          const productTypeOptions = availableProductTypes.map((item) => item.name);
          const otherOption = availableProductTypes.find((item) => item.isOther);
          const responseMessage = "What type of product are you using?";
          const previousAssistantMessage = [...messages]
            .reverse()
            .find((entry) => entry.role === "assistant") as
            | (ChatMessage & { requests?: PlannerOutput["requests"] })
            | undefined;
          const expectingOtherDetail = Boolean(
            previousAssistantMessage?.requests?.some((request) => request.id === "product_type_other_detail")
          );
          const normalizedMessage = message.trim().toLowerCase();
          const normalizedOptions = new Map(
            availableProductTypes.map((item) => [item.name.trim().toLowerCase(), item.name])
          );
          const matchedOption = normalizedOptions.get(normalizedMessage);
          if (shouldBypassDiagnosis) {
            const provisionalProductType =
              matchedOption ??
              (!isPlaceholderUserMessage(message) &&
              !isTrivialMessage(message) &&
              !isIdontKnowMessage(message)
                ? message.trim()
                : null);
            const { instructionText, guideImages } = await getClearancePrompt();
            const clearanceResponseMessage = `Thanks. ${instructionText}`;
            const assistantTurn: ChatMessage & {
              requests?: PlannerOutput["requests"];
              guideImages?: string[];
            } = {
              role: "assistant",
              content: clearanceResponseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "photo",
                  id: "clearance_photos",
                  prompt: "Please upload machine clearance photos from different angles.",
                  expectedInput: { type: "photo" },
                },
              ],
              guideImages: guideImages.length > 0 ? guideImages : undefined,
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                productType: provisionalProductType ?? session.productType ?? null,
                messages,
                phase: "clearance_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: clearanceResponseMessage,
                phase: "clearance_check",
                requests: assistantTurn.requests,
                guideImages: assistantTurn.guideImages,
              })
            );
            closeController(controller);
            return;
          }

          if (!message.trim() || isPlaceholderUserMessage(message) || isTrivialMessage(message)) {
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: `${responseMessage} If you choose Other, please specify the exact product.`,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "product_type",
                  prompt: responseMessage,
                  expectedInput: { type: "enum", options: productTypeOptions },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "product_type_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: assistantTurn.content,
                phase: "product_type_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }

          if (inputSource === "skip" || isIdontKnowMessage(message)) {
            const productTypeForUnknown = otherOption?.name ?? "Other";
            const ackMessage = "No problem. We'll continue with general guidance.";
            const { instructionText, guideImages } = await getClearancePrompt();
            const clearanceResponseMessage = `${ackMessage} ${instructionText}`;
            const assistantTurn: ChatMessage & {
              requests?: PlannerOutput["requests"];
              guideImages?: string[];
            } = {
              role: "assistant",
              content: clearanceResponseMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "photo",
                  id: "clearance_photos",
                  prompt: "Please upload machine clearance photos from different angles.",
                  expectedInput: { type: "photo" },
                },
              ],
              guideImages: guideImages.length > 0 ? guideImages : undefined,
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                productType: productTypeForUnknown,
                messages,
                phase: "clearance_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));
            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: clearanceResponseMessage,
                phase: "clearance_check",
                requests: assistantTurn.requests,
                guideImages: assistantTurn.guideImages,
              })
            );
            closeController(controller);
            return;
          }

          if (otherOption && matchedOption === otherOption.name && !expectingOtherDetail) {
            const askDetailMessage = "Please type the exact product type you are using.";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: askDetailMessage,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "product_type_other_detail",
                  prompt: askDetailMessage,
                  expectedInput: { type: "text" },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "product_type_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: askDetailMessage,
                phase: "product_type_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }

          const chosenProductType = matchedOption ?? (expectingOtherDetail ? message.trim() : "");
          if (!chosenProductType) {
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: `${responseMessage} If you choose Other, please specify the exact product.`,
              timestamp: new Date().toISOString(),
              requests: [
                {
                  type: "question",
                  id: "product_type",
                  prompt: responseMessage,
                  expectedInput: { type: "enum", options: productTypeOptions },
                },
              ],
            };
            messages.push(assistantTurn);
            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: "product_type_check",
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: assistantTurn.content,
                phase: "product_type_check",
                requests: assistantTurn.requests,
              })
            );
            closeController(controller);
            return;
          }

          await db
            .update(diagnosticSessions)
            .set({
              productType: chosenProductType,
              messages,
              phase: "clearance_check",
              status: "active",
              updatedAt: new Date(),
            })
            .where(eq(diagnosticSessions.id, sessionId));
          session = {
            ...session,
            productType: chosenProductType,
            phase: "clearance_check",
            status: "active",
          };

          const { instructionText, guideImages } = await getClearancePrompt();
          const clearanceResponseMessage = `Thanks. ${instructionText}`;
          const assistantTurn: ChatMessage & {
            requests?: PlannerOutput["requests"];
            guideImages?: string[];
          } = {
            role: "assistant",
            content: clearanceResponseMessage,
            timestamp: new Date().toISOString(),
            requests: [
              {
                type: "photo",
                id: "clearance_photos",
                prompt: "Please upload machine clearance photos from different angles.",
                expectedInput: { type: "photo" },
              },
            ],
            guideImages: guideImages.length > 0 ? guideImages : undefined,
          };
          messages.push(assistantTurn);

          await db
            .update(diagnosticSessions)
            .set({
              messages,
              phase: "clearance_check",
              status: "active",
              updatedAt: new Date(),
            })
            .where(eq(diagnosticSessions.id, sessionId));

          sendEvent(
            controller,
            "message",
            JSON.stringify({
              sessionId,
              message: clearanceResponseMessage,
              phase: "clearance_check",
              requests: assistantTurn.requests,
              guideImages: guideImages.length > 0 ? guideImages : undefined,
            })
          );
          closeController(controller);
          return;
        }

        if (session.phase === "clearance_check") {
          audit.logPhasePath("clearance_check");
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_clearance }));
          const { instructionText, guideImages } = await getClearancePrompt();

          if (imageBuffers.length === 0) {
            const userDeclinedPhoto =
              inputSource === "skip" ||
              isSkipSignal(message) ||
              isIdontHavePhotoMessage(message);

            if (userDeclinedPhoto) {
              const ackMessage =
                "No problem. We'll continue without clearance photos so our team can still help if we need to escalate.";
              const assistantTurn: ChatMessage & {
                requests?: PlannerOutput["requests"];
                guideImages?: string[];
              } = {
                role: "assistant",
                content: ackMessage,
                timestamp: new Date().toISOString(),
                requests: [],
                guideImages: undefined,
              };
              messages.push(assistantTurn);
              await db
                .update(diagnosticSessions)
                .set({
                  messages,
                  phase: "triaging",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));
              session = {
                ...session,
                messages,
                phase: "triaging",
                status: "active",
              };
              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: ackMessage,
                  phase: "triaging",
                  requests: [],
                })
              );
              // Fall through so triaging block runs in same request
            } else {
              const responseMessage = instructionText;
              const assistantTurn: ChatMessage & {
                requests?: PlannerOutput["requests"];
                guideImages?: string[];
              } = {
                role: "assistant",
                content: responseMessage,
                timestamp: new Date().toISOString(),
                requests: [
                  {
                    type: "photo",
                    id: "clearance_photos",
                    prompt: "Please upload machine clearance photos from different angles.",
                    expectedInput: { type: "photo" },
                  },
                ],
                guideImages: guideImages.length > 0 ? guideImages : undefined,
              };
              messages.push(assistantTurn);

              await db
                .update(diagnosticSessions)
                .set({
                  messages,
                  phase: "clearance_check",
                  status: "active",
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "clearance_check",
                  requests: assistantTurn.requests,
                  guideImages: guideImages.length > 0 ? guideImages : undefined,
                })
              );
              closeController(controller);
              return;
            }
          }

          const existingClearancePaths = Array.isArray(session.clearanceImagePaths)
            ? session.clearanceImagePaths.filter((value): value is string => typeof value === "string")
            : [];
          const combinedClearancePaths = Array.from(new Set([...existingClearancePaths, ...imagePaths]));
          imageBuffersForLlm = [];

          await db
            .update(diagnosticSessions)
            .set({
              clearanceImagePaths: combinedClearancePaths,
              messages,
              phase: "triaging",
              status: "active",
              updatedAt: new Date(),
            })
            .where(eq(diagnosticSessions.id, sessionId));
          session = {
            ...session,
            clearanceImagePaths: combinedClearancePaths,
            phase: "triaging",
            status: "active",
          };
        }

        const isTriageFlow = session.phase === "triaging";
        if (isTriageFlow && shouldBypassDiagnosis) {
          const escalationReason =
            "Diagnosis mode is disabled for public users; escalating after intake collection.";
          messages.push({
            role: "assistant",
            content: generalEscalationMessage,
            content_html: generalEscalationMessageHtml,
            timestamp: new Date().toISOString(),
          });
          const evidence = (session.evidence as Record<string, unknown>) ?? {};
          const hypotheses = (session.hypotheses as unknown[]) ?? [];
          const escalationHandoff = buildEscalationHandoff({
            sessionId,
            userName: session.userName ?? null,
            userPhone: session.userPhone ?? null,
            machineModel: session.machineModel ?? null,
            serialNumber: session.serialNumber ?? null,
            productType: session.productType ?? null,
            manufacturingYear: session.manufacturingYear ?? null,
            clearanceImagePaths: session.clearanceImagePaths ?? [],
            escalationReason,
            playbookTitle: "Pre-diagnosis",
            labelId: "diagnosis_mode_disabled",
            turnCount: session.turnCount ?? 0,
            evidence: evidence as Parameters<typeof buildEscalationHandoff>[0]["evidence"],
            hypotheses: hypotheses as Parameters<typeof buildEscalationHandoff>[0]["hypotheses"],
            messages,
          });
          await db
            .update(diagnosticSessions)
            .set({
              messages,
              phase: "escalated",
              status: "escalated",
              escalationReason,
              escalationHandoff,
              updatedAt: new Date(),
            })
            .where(eq(diagnosticSessions.id, sessionId));
          sendEvent(
            controller,
            "message",
            JSON.stringify({
              sessionId,
              message: generalEscalationMessage,
              message_html: generalEscalationMessageHtml,
              phase: "escalated",
              requests: [],
              escalation_reason: escalationReason,
            })
          );
          sendEscalationWebhook(escalationHandoff).catch(() => {});
          sendEscalationTelegram(escalationHandoff).catch(() => {});
          closeController(controller);
          return;
        }
        if (isTriageFlow) {
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.selecting_playbook }));
          if (imageBuffersForLlm.length > 0) {
            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.analysing_photos }));
          }

          const allPlaybooks = await db
            .select({
              id: playbooks.id,
              labelId: playbooks.labelId,
              title: playbooks.title,
            })
            .from(playbooks);
          const playbookProductTypeAssignments = allPlaybooks.length
            ? await db
                .select({
                  playbookId: playbookProductTypes.playbookId,
                  productTypeName: productTypes.name,
                })
                .from(playbookProductTypes)
                .innerJoin(productTypes, eq(playbookProductTypes.productTypeId, productTypes.id))
                .where(inArray(playbookProductTypes.playbookId, allPlaybooks.map((pb) => pb.id)))
            : [];
          const productTypesByPlaybookId = new Map<string, string[]>();
          for (const assignment of playbookProductTypeAssignments) {
            const existing = productTypesByPlaybookId.get(assignment.playbookId);
            if (existing) {
              existing.push(assignment.productTypeName);
            } else {
              productTypesByPlaybookId.set(assignment.playbookId, [assignment.productTypeName]);
            }
          }
          const allLabels = await db.select().from(labels);
          const labelsById = new Map(allLabels.map((l) => [l.id, l]));
          const triageLabelsByLabel = new Map<
            string,
            {
              labelId: string;
              playbookTitle: string;
              displayName: string;
              description: string | null;
              productTypes: Set<string>;
            }
          >();
          for (const pb of allPlaybooks) {
            const labelMeta = labelsById.get(pb.labelId);
            const existing = triageLabelsByLabel.get(pb.labelId);
            const playbookProductTypesForLabel = productTypesByPlaybookId.get(pb.id) ?? [];
            if (existing) {
              for (const name of playbookProductTypesForLabel) {
                existing.productTypes.add(name);
              }
              continue;
            }
            triageLabelsByLabel.set(pb.labelId, {
              labelId: pb.labelId,
              playbookTitle: pb.title,
              displayName: labelMeta?.displayName ?? pb.labelId,
              description: labelMeta?.description ?? null,
              productTypes: new Set(playbookProductTypesForLabel),
            });
          }
          const triageLabels = Array.from(triageLabelsByLabel.values()).map((item) => ({
            labelId: item.labelId,
            playbookTitle: item.playbookTitle,
            displayName: item.displayName,
            description: item.description,
            productTypes: Array.from(item.productTypes),
          }));

          triageRound += 1;
          const nextTriageHistory: TriageHistoryItem[] = [
            ...triageHistory,
            { role: "user", content: message || "(sent photos)" },
          ];
          // Include images from session (e.g. first message photo + text) for playbook selection
          const sessionImageBuffers: Buffer[] = [];
          for (const m of messages) {
            if (m.role === "user" && m.images?.length) {
              for (const relPath of m.images) {
                try {
                  sessionImageBuffers.push(await readStorageFile(relPath));
                } catch {
                  // skip missing or unreadable session images
                }
              }
            }
          }
          const allTriageImageBuffers =
            sessionImageBuffers.length > 0 || imageBuffersForLlm.length > 0
              ? [...sessionImageBuffers, ...imageBuffersForLlm]
              : undefined;
          const triageResult = await withKeepalive(
            controller,
            runPlaybookTriage({
              labels: triageLabels,
              triageHistory: nextTriageHistory,
              imageBuffers: allTriageImageBuffers,
              currentProductType: session.productType,
            }, audit)
          );
          console.log(
            `[chat] triage (session=${sessionId}) selected_label=${triageResult.selectedLabelId ?? "null"} confidence=${triageResult.confidence.toFixed(2)} candidates=[${triageResult.candidateLabels.join(", ")}]`
          );

          const matchedPlaybookCandidates = triageResult.selectedLabelId
            ? allPlaybooks.filter((pb) => pb.labelId === triageResult.selectedLabelId)
            : [];
          const normalize = (value: string) => value.trim().toLowerCase();
          const normalizedSessionProductType = session.productType
            ? normalize(session.productType)
            : "";
          const matchedPlaybook =
            matchedPlaybookCandidates.length === 0
              ? null
              : normalizedSessionProductType
                ? matchedPlaybookCandidates.find((pb) =>
                    (productTypesByPlaybookId.get(pb.id) ?? [])
                      .map(normalize)
                      .includes(normalizedSessionProductType)
                  ) ??
                  matchedPlaybookCandidates.find(
                    (pb) => (productTypesByPlaybookId.get(pb.id) ?? []).length === 0
                  ) ??
                  matchedPlaybookCandidates[0]
                : matchedPlaybookCandidates[0];
          const canAutoSelect =
            !!matchedPlaybook &&
            triageResult.confidence >= triageConfig.autoSelectThreshold;
          const canConfirmSelect =
            !!matchedPlaybook &&
            triageRound >= triageConfig.maxRounds &&
            triageResult.confidence >= triageConfig.confirmThreshold;

          if (canAutoSelect || canConfirmSelect) {
            console.log(
              `[chat] playbook assigned (session=${sessionId}) label=${matchedPlaybook?.labelId} title="${matchedPlaybook?.title ?? ""}"`
            );
          }

          if (!canAutoSelect && !canConfirmSelect) {
            console.log(
              `[chat] triage follow-up (session=${sessionId}) round=${triageRound} asking user to disambiguate`
            );
            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.asking_followup }));

            const candidateOptions = triageResult.candidateLabels
              .map((id) => labelsById.get(id)?.displayName ?? id)
              .slice(0, 3);
            const followUpQuestion =
              triageResult.followUpQuestion ??
              "I need one more detail to choose the correct diagnostic guide. What symptom do you notice first?";
            const shouldEscalate = triageRound >= triageConfig.maxRounds;
            const responseMessage = shouldEscalate
              ? generalEscalationMessage
              : followUpQuestion;
            const responsePhase = shouldEscalate ? "escalated" : "triaging";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
              ...(shouldEscalate ? { content_html: generalEscalationMessageHtml } : {}),
              timestamp: new Date().toISOString(),
              requests: !shouldEscalate
                ? [
                    {
                      type: "question",
                      id: "triage_followup",
                      prompt: followUpQuestion,
                      expectedInput: candidateOptions.length >= 2
                        ? { type: "enum", options: candidateOptions }
                        : { type: "text" },
                    },
                  ]
                : undefined,
            };
            messages.push(assistantTurn);

            await db
              .update(diagnosticSessions)
              .set({
                messages,
                phase: responsePhase,
                status: shouldEscalate ? "escalated" : "active",
                escalationReason: shouldEscalate
                  ? "Unable to confidently identify a playbook after triage follow-ups."
                  : null,
                triageRound,
                triageHistory: [
                  ...nextTriageHistory,
                  { role: "assistant", content: responseMessage },
                ],
                updatedAt: new Date(),
              })
              .where(eq(diagnosticSessions.id, sessionId));

            sendEvent(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                message_html: shouldEscalate ? generalEscalationMessageHtml : undefined,
                phase: responsePhase,
                requests: assistantTurn.requests,
                escalation_reason: shouldEscalate
                  ? "Unable to confidently identify a playbook after triage follow-ups."
                  : undefined,
              })
            );
            closeController(controller);
            return;
          }

          await db
            .update(diagnosticSessions)
            .set({
              playbookId: matchedPlaybook?.id ?? null,
              phase: "gathering_info",
              triageRound,
              triageHistory: [
                ...nextTriageHistory,
                {
                  role: "assistant",
                  content: `Selected playbook ${matchedPlaybook?.title ?? "unknown"} with confidence ${triageResult.confidence.toFixed(2)}.`,
                },
              ],
              updatedAt: new Date(),
            })
            .where(eq(diagnosticSessions.id, sessionId));

          session = {
            ...session,
            playbookId: matchedPlaybook?.id ?? null,
            phase: "gathering_info",
            triageRound,
            triageHistory: [
              ...nextTriageHistory,
              {
                role: "assistant",
                content: `Selected playbook ${matchedPlaybook?.title ?? "unknown"} with confidence ${triageResult.confidence.toFixed(2)}.`,
              },
            ],
          };

        }

        const playbookRow = session.playbookId
          ? (await db.select().from(playbooks).where(eq(playbooks.id, session.playbookId)))[0]
          : null;
        if (!playbookRow) {
          throw new Error("No playbook found for this session.");
        }

        const playbook: DiagnosticPlaybook = {
          id: playbookRow.id,
          labelId: playbookRow.labelId,
          title: playbookRow.title,
          steps: (playbookRow.steps as DiagnosticPlaybook["steps"]) ?? [],
          symptoms: playbookRow.symptoms as DiagnosticPlaybook["symptoms"],
          evidenceChecklist: playbookRow.evidenceChecklist as DiagnosticPlaybook["evidenceChecklist"],
          candidateCauses: playbookRow.candidateCauses as DiagnosticPlaybook["candidateCauses"],
          escalationTriggers: playbookRow.escalationTriggers as DiagnosticPlaybook["escalationTriggers"],
        };

        const evidence = (session.evidence as Record<string, EvidenceRecord>) ?? {};
        let hypotheses = (session.hypotheses as HypothesisState[]) ?? [];
        let phase: PlannerOutput["phase"] = session.phase as PlannerOutput["phase"];
        let turnCount = session.turnCount + 1;
        evidenceForError = evidence;
        hypothesesForError = hypotheses;
        turnCountForError = turnCount;
        playbookIdForError = playbook.id;
        machineModelForError = session.machineModel ?? machineModelForError;
        let newFrustrationTurnCount: number | null = null;
        let newEscalationContextTurnCount: number | null = null;

        const lastAssistantMessage = messages.filter((m) => m.role === "assistant").pop();
        const outstandingRequestIds =
          (lastAssistantMessage as { requests?: { id: string }[] } | undefined)?.requests?.map(
            (r) => r.id
          ) ?? [];
        const explicitIdkMessage =
          message.trim().length > 0 && isIdontKnowMessage(message);
        const lastUserWasSkip =
          inputSource === "skip" ||
          isSkipSignal(message) ||
          explicitIdkMessage;
        const skipEvidenceIds = (playbook.evidenceChecklist ?? [])
          .filter(
            (item) =>
              outstandingRequestIds.includes(item.id) ||
              (item.actionId ? outstandingRequestIds.includes(item.actionId) : false)
          )
          .map((item) => item.id);
        const escalationOfferOutstanding = outstandingRequestIds.includes(ESCALATION_OFFER_REQUEST_ID);
        const regexEscalationIntent = messageContainsEscalationIntent(
          message,
          frustrationPatterns
        );

        let plannerOutput: PlannerOutput | null = null;
        let plannerLogged = false;
        let chunksForTurn: {
          id: string;
          content: string;
          metadata?: unknown;
          documentId?: string;
        }[] = [];

        // Post-resolution: capture verification feedback, then answer follow-ups
        if (session.status === "resolved") {
          audit.logPhasePath("resolved_followup");
          const lastResolution = (lastAssistantMessage as { resolution?: PlannerOutput["resolution"] } | undefined)?.resolution;
          const hasOutcome = session.resolutionOutcome != null;
          const verificationRequested =
            outstandingRequestIds.includes(VERIFICATION_REQUEST_ID);

          // Parse verification feedback from user's message
          if (!hasOutcome) {
            const lower = message.toLowerCase();
            const positive = verificationRequested
              ? /\b(yes|fixed|worked|resolved)\b/.test(lower)
              : /\b(yes|fixed|worked|resolved|better|good|great|perfect|thanks|thank)\b/.test(lower);
            const negative = /\b(no|not fixed|didn'?t work|still|same|worse|problem)\b/.test(lower);
            const partial = !verificationRequested && /\b(partially|somewhat|a bit|little|slightly)\b/.test(lower);

            let outcome: string;
            let responseMessage: string;
            if (positive && !negative) {
              outcome = "confirmed";
              responseMessage = "Great to hear the issue is resolved! If you have any other questions, feel free to ask.";
            } else if (partial) {
              outcome = "partially_fixed";
              responseMessage = "It sounds like the issue is partially resolved. Let me know what's still not right and I can help further, or I can connect you with a technician.";
            } else if (negative) {
              outcome = "not_fixed";
              responseMessage = "I'm sorry the steps didn't fully resolve the issue. Let me connect you with a technician who can help further.";
            } else {
              // Ambiguous response while answering verification request: keep asking the same yes/no confirmation.
              if (verificationRequested) {
                const clarificationMessage =
                  "Please confirm so I can track the outcome: did the steps fix the issue?";
                const verificationRequest = buildVerificationRequest(
                  intentManifest.communication.verificationQuestion
                );
                messages.push({
                  role: "assistant",
                  content: clarificationMessage,
                  timestamp: new Date().toISOString(),
                  requests: [verificationRequest],
                } as ChatMessage & { requests?: PlannerOutput["requests"] });
                await db
                  .update(diagnosticSessions)
                  .set({ messages, phase: "resolved_followup", updatedAt: new Date() })
                  .where(eq(diagnosticSessions.id, sessionId));

                sendEvent(
                  controller,
                  "message",
                  JSON.stringify({
                    sessionId,
                    message: clarificationMessage,
                    phase: "resolved_followup",
                    requests: [verificationRequest],
                  })
                );
                closeController(controller);
                return;
              }

              // Ambiguous — treat as follow-up question.
              outcome = "";
              responseMessage = "";
            }

            if (outcome) {
              await db
                .update(diagnosticSessions)
                .set({
                  resolutionOutcome: outcome,
                  verificationRespondedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(diagnosticSessions.id, sessionId));

              if (outcome === "not_fixed") {
                phase = "escalated";
                plannerOutput = {
                  message: responseMessage,
                  phase: "escalated",
                  requests: [],
                  hypotheses_update: hypotheses,
                  evidence_extracted: [],
                  escalation_reason: "Resolution did not fix the issue",
                };

                messages.push({
                  role: "assistant",
                  content: responseMessage,
                  timestamp: new Date().toISOString(),
                });
                await db
                  .update(diagnosticSessions)
                  .set({
                    messages,
                    phase: "escalated",
                    status: "escalated",
                    escalationReason: "Resolution did not fix the issue",
                    updatedAt: new Date(),
                  })
                  .where(eq(diagnosticSessions.id, sessionId));

                sendEvent(
                  controller,
                  "message",
                  JSON.stringify({
                    sessionId,
                    message: responseMessage,
                    phase: "escalated",
                    requests: [],
                    escalation_reason: "Resolution did not fix the issue",
                  })
                );
                closeController(controller);
                return;
              }

              phase = "resolved_followup";
              plannerOutput = {
                message: responseMessage,
                phase: "resolved_followup",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
              };

              messages.push({
                role: "assistant",
                content: responseMessage,
                timestamp: new Date().toISOString(),
              });
              await db
                .update(diagnosticSessions)
                .set({ messages, phase, updatedAt: new Date() })
                .where(eq(diagnosticSessions.id, sessionId));

              sendEvent(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "resolved_followup",
                  requests: [],
                })
              );
              closeController(controller);
              return;
            }
          }

          // Either already have outcome or ambiguous message — answer as follow-up
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.searching_manuals }));
          const queryText = message;
          const keywordQuery = `${message} ${playbook.labelId}`.trim();
          const queryEmbedding = await openaiTextEmbedder.embed(queryText);
          const chunks = await searchDocChunks(
            queryEmbedding,
            8,
            session.machineModel ?? undefined,
            undefined,
            keywordQuery
          );
          audit.logRagRetrieval({
            query: queryText,
            chunksReturned: chunks.length,
            chunkIds: chunks.map((c) => c.id),
            documentIds: [...new Set(chunks.map((c) => c.documentId))],
            topSimilarity: chunks[0]?.similarity,
          });
          chunksForTurn = chunks.map((c) => ({
            id: c.id,
            content: c.content,
            metadata: c.metadata,
            documentId: c.documentId,
          }));
          let followUpMessage: string;
          if (chunksForTurn.length === 0) {
            followUpMessage =
              "I don't have documentation in the knowledge base to answer that question. Please contact a technician for further assistance.";
          } else {
            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.thinking }));
            followUpMessage = await withKeepalive(
              controller,
              runFollowUpAnswer({
                recentMessages: messages.slice(0, -1),
                docChunks: chunksForTurn,
                lastUserMessage: message,
                resolution: lastResolution,
                machineModel: session.machineModel ?? undefined,
                imageBuffers: imageBuffersForLlm.length > 0 ? imageBuffersForLlm : undefined,
              }, audit)
            );
          }
          phase = "resolved_followup";
          plannerOutput = {
            message: followUpMessage,
            phase: "resolved_followup",
            requests: [],
            hypotheses_update: hypotheses,
            evidence_extracted: [],
          };
        } else {
          audit.logPhasePath("diagnostic_loop");
          let handledEscalationOffer = false;
          let plannerUserMessage = message;
          if (escalationOfferOutstanding) {
            const normalized = normalizeUserMessage(message);
            const wantsEscalation =
              normalized === "yes" ||
              normalized === "yes, connect me" ||
              /\b(yes|connect|technician|support)\b/.test(normalized);
            if (wantsEscalation) {
              phase = "escalated";
              plannerOutput = {
                message: frustrationEscalationMessage,
                message_html: frustrationEscalationMessageHtml,
                phase: "escalated",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
                escalation_reason: "User requested escalation after repeated skipped questions",
              };
            } else {
              plannerUserMessage =
                "User chose not to escalate and wants to continue troubleshooting with an alternate check.";
            }
            handledEscalationOffer = wantsEscalation;
          }
          if (!handledEscalationOffer) {
            const escalationFromTrigger = checkEscalationTriggers(
              message,
              playbook.escalationTriggers
            );
            /** Only enforce turn cap as a safety net; normal end is resolve or planner/stall escalation. */
            const overSafetyTurnCap = turnCount > diagnosticConfig.maxTurns;

            if (escalationFromTrigger.triggered) {
              phase = "escalated";
              plannerOutput = {
                message: generalEscalationMessage,
                message_html: generalEscalationMessageHtml,
                phase: "escalated",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
                escalation_reason: escalationFromTrigger.matched?.reason ?? "Safety trigger detected",
              };
            } else if (overSafetyTurnCap) {
              phase = "escalated";
              plannerOutput = {
                message: generalEscalationMessage,
                message_html: generalEscalationMessageHtml,
                phase: "escalated",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
                escalation_reason: "Session length limit reached",
              };
            } else {
            const actionIds = new Set<string>();
            playbook.evidenceChecklist?.forEach((e) => e.actionId && actionIds.add(e.actionId));
            const actionIdsArr = Array.from(actionIds);
            const relevantActions = actionIdsArr.length
              ? await db.select().from(actions).where(inArray(actions.id, actionIdsArr))
              : [];
            const actionsById = new Map<string, ActionRecord>();
            relevantActions.forEach((a) =>
              actionsById.set(a.id, {
                id: a.id,
                title: a.title,
                instructions: a.instructions,
                expectedInput: a.expectedInput,
                safetyLevel: a.safetyLevel,
              })
            );

            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.searching_manuals }));
            const sentimentPromise: Promise<SentimentSignal | null> =
              intentManifest.frustrationHandling.sentimentClassifierEnabled
                ? runSentimentClassifier({
                    latestMessage: message,
                    recentMessages: messages.slice(0, -1),
                  })
                : Promise.resolve(null);

            const queryTextForRag = `${plannerUserMessage}\nLabel context: ${playbook.labelId}`;
            const queryEmbedding = await openaiTextEmbedder.embed(queryTextForRag);
            const chunks = await searchDocChunks(
              queryEmbedding,
              8,
              session.machineModel ?? undefined,
              undefined,
              plannerUserMessage
            );
            const sentimentSignal = await sentimentPromise;
            const threshold = intentManifest.frustrationHandling.frustrationEscalationThreshold;
            const sentimentIndicatesEscalation =
              sentimentSignal &&
              (sentimentSignal.escalationIntent ||
                (threshold === "moderate"
                  ? (sentimentSignal.frustrationLevel === "moderate" ||
                      sentimentSignal.frustrationLevel === "high")
                  : sentimentSignal.frustrationLevel === "high"));
            const frustrationThisTurn =
              regexEscalationIntent ||
              Boolean(sentimentIndicatesEscalation);
            const prevFrustrationCount =
              (session as { frustrationTurnCount?: number }).frustrationTurnCount ??
              0;
            const messageIsAnswerToRequest =
              inputSource === "structured" ||
              (outstandingRequestIds.length > 0 && /^-?\d*\.?\d+$/.test(message.trim()));
            newFrustrationTurnCount = frustrationThisTurn
              ? prevFrustrationCount + 1
              : prevFrustrationCount;
            const consecutiveThreshold =
              intentManifest.frustrationHandling
                .consecutiveFrustrationTurnsBeforeEscalation;
            const cumulativeIndicatesEscalation =
              newFrustrationTurnCount >= consecutiveThreshold;
            const userExpressedEscalationIntent =
              regexEscalationIntent ||
              Boolean(sentimentIndicatesEscalation) ||
              cumulativeIndicatesEscalation;
            const userExplicitlyAskedForHuman =
              messageExplicitlyAsksForHuman(
                message,
                intentManifest.frustrationHandling.detectionPatterns
              ) || Boolean(sentimentSignal?.escalationIntent);

            if (sentimentSignal) {
              audit.logSentimentSignal({
                frustrationLevel: sentimentSignal.frustrationLevel,
                escalationIntent: sentimentSignal.escalationIntent,
                reasoning: sentimentSignal.reasoning,
              });
            }

            const prevEscalationContextTurns =
              (session as { escalationContextTurnCount?: number })
                .escalationContextTurnCount ?? 0;
            const alternatePathsLimit =
              intentManifest.frustrationHandling.alternatePathsBeforeEscalation;
            const forceEscalateAfterAlternatePaths =
              userExpressedEscalationIntent &&
              !userExplicitlyAskedForHuman &&
              frustrationThisTurn &&
              !messageIsAnswerToRequest &&
              prevEscalationContextTurns >= alternatePathsLimit;

            if (userExplicitlyAskedForHuman) {
              newEscalationContextTurnCount = 0;
              phase = "escalated";
              plannerOutput = {
                message: frustrationEscalationMessage,
                message_html: frustrationEscalationMessageHtml,
                phase: "escalated",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
                escalation_reason: "User asked to speak with a human",
              };
            } else if (forceEscalateAfterAlternatePaths) {
              newEscalationContextTurnCount = 0;
              phase = "escalated";
              plannerOutput = {
                message: frustrationEscalationMessage,
                message_html: frustrationEscalationMessageHtml,
                phase: "escalated",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
                escalation_reason:
                  "Repeated frustration — connecting you with a technician",
              };
            } else {
              newEscalationContextTurnCount =
                userExpressedEscalationIntent
                  ? prevEscalationContextTurns + 1
                  : prevEscalationContextTurns;
            const plannerLastUserMessage = lastUserWasSkip
              ? `User replied "I don't know" and skipped answering outstanding request IDs: ${outstandingRequestIds.join(", ") || "(none)"}.`
              : userExpressedEscalationIntent
                ? `${plannerUserMessage}\n\n[Context: user appears to be asking for human help. ${intentManifest.frustrationHandling.empathyAcknowledgment ? "Show empathy and " : ""}try up to ${intentManifest.frustrationHandling.alternatePathsBeforeEscalation} alternate troubleshooting path(s) before escalating unless unsafe.]`
                : plannerUserMessage;

            audit.logRagRetrieval({
              query: queryTextForRag,
              chunksReturned: chunks.length,
              chunkIds: chunks.map((c) => c.id),
              documentIds: [...new Set(chunks.map((c) => c.documentId))],
              topSimilarity: chunks[0]?.similarity,
            });
            chunksForTurn = chunks.map((c) => ({
              id: c.id,
              content: c.content,
              metadata: c.metadata,
              documentId: c.documentId,
            }));

            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.thinking }));
            plannerOutput = await withKeepalive(
              controller,
              runDiagnosticPlanner({
                playbook,
                evidence,
                hypotheses,
                phase,
                turnCount,
                recentMessages: messages.slice(0, -1),
                docChunks: chunksForTurn,
                actions: Array.from(actionsById.values()),
                lastUserMessage: plannerLastUserMessage,
                machineModel: session.machineModel ?? undefined,
                outstandingRequestIds,
                inputSource,
                imageBuffers: imageBuffersForLlm.length > 0 ? imageBuffersForLlm : undefined,
                sentimentSignal: sentimentSignal ?? undefined,
              }, audit)
            );

            const inferredEvidence = inferEvidenceFromOutstandingRequest({
              message,
              outstandingRequestIds,
              playbook,
            });
            if (inferredEvidence.length > 0) {
              const existing = new Set(
                plannerOutput.evidence_extracted.map((item) => item.evidenceId)
              );
              for (const item of inferredEvidence) {
                if (!existing.has(item.evidenceId)) {
                  plannerOutput.evidence_extracted.push(item);
                }
              }
            }

            const { output: sanitized, errors: sanitizeErrors } = validateAndSanitizePlannerOutput(
              plannerOutput,
              playbook,
              actionsById,
              true,
              { maxRequestsPerTurn: diagnosticConfig.maxRequestsPerTurn }
            );
            const requestsBeforeDedup = [...sanitized.requests];
            const dedupedRequests = preventRepeatedChecklistRequests({
              requests: sanitized.requests,
              playbook,
              evidence,
              evidenceExtracted: sanitized.evidence_extracted,
              actionsById,
            });
            if (dedupedRequests.removedRequestIds.length > 0) {
              sanitizeErrors.push(
                `Removed repeated requests for already-collected evidence: ${dedupedRequests.removedRequestIds.join(", ")}`
              );
            }
            if (dedupedRequests.fallbackEvidenceId) {
              sanitizeErrors.push(
                `Inserted fallback request for missing evidence: ${dedupedRequests.fallbackEvidenceId}`
              );
            }
            sanitized.requests = dedupedRequests.requests;
            const requestsChanged =
              requestsBeforeDedup.length !== sanitized.requests.length ||
              requestsBeforeDedup.some((req, idx) => {
                const next = sanitized.requests[idx];
                return !next || req.id !== next.id || req.prompt !== next.prompt;
              });
            if (requestsChanged) {
              if (sanitized.requests.length > 0) {
                sanitized.message = `Thanks for the update. Next, please: ${sanitized.requests[0].prompt}`;
              } else if (
                sanitized.phase === "gathering_info" ||
                sanitized.phase === "diagnosing"
              ) {
                sanitized.message =
                  "Thanks for the update. I have enough from this step and will continue with the next analysis.";
              }
              if ("message_html" in sanitized) {
                delete (sanitized as { message_html?: string }).message_html;
              }
            }
            audit.logPlannerOutput(plannerOutput, sanitized, sanitizeErrors);
            plannerLogged = true;
            plannerOutput = sanitized;

            // Handle playbook switch suggestion
            if (plannerOutput.suggested_label_switch) {
              const switchLabel = plannerOutput.suggested_label_switch;
              const [switchPb] = await db
                .select()
                .from(playbooks)
                .where(eq(playbooks.labelId, switchLabel));
              if (switchPb && switchPb.id !== session.playbookId) {
                await db
                  .update(diagnosticSessions)
                  .set({ playbookId: switchPb.id, updatedAt: new Date() })
                  .where(eq(diagnosticSessions.id, sessionId));
                // Reset hypotheses for the new playbook
                hypotheses = [];
                if (process.env.NODE_ENV !== "test") {
                  console.log(`[chat] Switched playbook from ${playbook.labelId} to ${switchLabel} for session ${sessionId}`);
                }
              }
            }
            }
          }
          }
        }

        if (!plannerOutput) {
          throw new Error("Planner output was not generated for this turn");
        }

        if (!plannerLogged) {
          audit.logPlannerOutput(plannerOutput);
        }

        if (lastUserWasSkip && skipEvidenceIds.length > 0) {
          const extractedIds = new Set(plannerOutput.evidence_extracted.map((item) => item.evidenceId));
          for (const evidenceId of skipEvidenceIds) {
            if (extractedIds.has(evidenceId)) continue;
            plannerOutput.evidence_extracted.push({
              evidenceId,
              value: null,
              confidence: "uncertain",
            });
          }
        }

        const now = new Date().toISOString();
        for (const e of plannerOutput.evidence_extracted) {
          evidence[e.evidenceId] = {
            value: e.value,
            type: typeof e.value,
            confidence: e.confidence,
            photoAnalysis: e.photoAnalysis,
            collectedAt: now,
            turn: turnCount,
          };
        }

        if (plannerOutput.hypotheses_update.length > 0) {
          hypotheses = plannerOutput.hypotheses_update;
        }
        phase = plannerOutput.phase;

        const assistantMessage: ChatMessage & {
          requests?: PlannerOutput["requests"];
          resolution?: PlannerOutput["resolution"];
        } = {
          role: "assistant",
          content: plannerOutput.message,
          content_html: plannerOutput.message_html,
          timestamp: now,
          requests: plannerOutput.requests?.length ? plannerOutput.requests : undefined,
          ...(phase === "resolving" && plannerOutput.resolution
            ? { resolution: plannerOutput.resolution }
            : {}),
        };
        messages.push(assistantMessage);

        let status = session.status;
        let resolvedCauseId: string | null = null;
        let escalationReason: string | null = null;
        let verificationRequestedAt: Date | null | undefined = undefined;
        let verificationRespondedAt: Date | null | undefined = undefined;
        if (phase === "resolving") {
          status = "resolved";
          resolvedCauseId = plannerOutput.resolution?.causeId ?? null;
          verificationRequestedAt = new Date();
          verificationRespondedAt = null;
          // Append verification question
          const verificationSuffix = `\n\nAfter trying these steps, please let me know: ${intentManifest.communication.verificationQuestion}`;
          const verificationRequest = buildVerificationRequest(
            intentManifest.communication.verificationQuestion
          );
          plannerOutput = {
            ...plannerOutput,
            message: plannerOutput.message + verificationSuffix,
            requests: [verificationRequest],
          };
          assistantMessage.content = plannerOutput.message;
          assistantMessage.requests = plannerOutput.requests;
        } else if (phase === "escalated") {
          status = "escalated";
          escalationReason = plannerOutput.escalation_reason ?? null;
        }

        let responseToSend = plannerOutput;
        const consecutiveSkips = countConsecutiveSkipTurns(messages);
        const shouldOfferEscalationAfterSkips =
          status === "active" &&
          !escalationOfferOutstanding &&
          lastUserWasSkip &&
          consecutiveSkips >= diagnosticConfig.consecutiveSkipsBeforeEscalationOffer &&
          (phase === "gathering_info" || phase === "diagnosing");
        if (shouldOfferEscalationAfterSkips) {
          const offerMessage =
            "It looks like these checks are difficult to answer. Would you like me to connect you with a technician?";
          const offerRequest = {
            type: "question" as const,
            id: ESCALATION_OFFER_REQUEST_ID,
            prompt: offerMessage,
            expectedInput: {
              type: "enum",
              options: ["Yes, connect me", "No, continue troubleshooting"],
            },
          };
          responseToSend = {
            ...plannerOutput,
            message: offerMessage,
            phase,
            requests: [offerRequest],
          };
          messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            content: offerMessage,
            requests: [offerRequest],
          } as ChatMessage & { requests?: PlannerOutput["requests"] };
        }

        // If planner leaves a non-terminal phase with no requests and required evidence is already covered,
        // force escalation so the user gets a clear outcome instead of a dead-end turn.
        const evidenceCount = Object.keys(evidence).length;
        const requiredChecklistIds = (playbook.evidenceChecklist ?? [])
          .filter((item) => item.required)
          .map((item) => item.id);
        const requiredEvidenceComplete = requiredChecklistIds.every((id) => id in evidence);
        const nonTerminalWithNoNextStep =
          (phase === "diagnosing" || phase === "gathering_info") &&
          plannerOutput.requests.length === 0 &&
          !plannerOutput.resolution &&
          requiredEvidenceComplete &&
          evidenceCount >= Math.max(3, requiredChecklistIds.length);
        if (nonTerminalWithNoNextStep && status === "active") {
          phase = "escalated";
          status = "escalated";
          escalationReason =
            "We weren't able to pinpoint the cause from the information provided. Connecting you with a technician who can help further.";
          responseToSend = {
            ...plannerOutput,
            message: generalEscalationMessage,
            message_html: generalEscalationMessageHtml,
            phase: "escalated",
            requests: [],
            escalation_reason: escalationReason,
          };
          messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            content: generalEscalationMessage,
            content_html: generalEscalationMessageHtml,
          } as ChatMessage & { requests?: PlannerOutput["requests"] };
        }

        const lastEvidenceTurn = Math.max(
          0,
          ...Object.values(evidence).map((r) => r.turn)
        );
        const stallEscalation =
          turnCount >= 2 &&
          plannerOutput.evidence_extracted.length === 0 &&
          turnCount - lastEvidenceTurn >= diagnosticConfig.stallTurnsWithoutNewEvidence;
        if (stallEscalation && status === "active") {
          status = "escalated";
          phase = "escalated";
          escalationReason = "No new evidence for several turns; connecting you with support.";
          responseToSend = {
            ...plannerOutput,
            message: generalEscalationMessage,
            message_html: generalEscalationMessageHtml,
            phase: "escalated",
            requests: [],
            escalation_reason: escalationReason,
          };
          const stallMessage: ChatMessage = {
            role: "assistant",
            content: generalEscalationMessage,
            content_html: generalEscalationMessageHtml,
            timestamp: new Date().toISOString(),
          };
          messages[messages.length - 1] = stallMessage;
        }

        // Build escalation handoff if escalating
        let escalationHandoff: ReturnType<typeof buildEscalationHandoff> | null = null;
        if (status === "escalated" && escalationReason) {
          const lastResForHandoff = messages
            .filter((m: ChatMessage & { resolution?: PlannerOutput["resolution"] }) => m.role === "assistant" && (m as { resolution?: unknown }).resolution)
            .pop() as (ChatMessage & { resolution?: PlannerOutput["resolution"] }) | undefined;
          escalationHandoff = buildEscalationHandoff({
            sessionId,
            userName: session.userName ?? null,
            userPhone: session.userPhone ?? null,
            machineModel: session.machineModel ?? null,
            serialNumber: session.serialNumber ?? null,
            productType: session.productType ?? null,
            manufacturingYear: session.manufacturingYear ?? null,
            clearanceImagePaths: session.clearanceImagePaths ?? [],
            escalationReason,
            playbookTitle: playbook.title,
            labelId: playbook.labelId,
            turnCount,
            evidence,
            hypotheses,
            messages,
            resolution: lastResForHandoff?.resolution ?? undefined,
          });
        }

        const frustrationTurnCount =
          newFrustrationTurnCount ?? (session as { frustrationTurnCount?: number }).frustrationTurnCount ?? 0;
        const escalationContextTurnCount =
          newEscalationContextTurnCount ??
          (session as { escalationContextTurnCount?: number })
            .escalationContextTurnCount ??
          0;
        await db
          .update(diagnosticSessions)
          .set({
            messages,
            evidence,
            hypotheses,
            phase,
            turnCount,
            status,
            resolvedCauseId,
            escalationReason,
            verificationRequestedAt,
            verificationRespondedAt,
            escalationHandoff: escalationHandoff ?? undefined,
            frustrationTurnCount,
            escalationContextTurnCount,
            updatedAt: new Date(),
          })
          .where(eq(diagnosticSessions.id, sessionId));

        if (escalationHandoff) {
          // Fire-and-forget: don't block the response
          sendEscalationWebhook(escalationHandoff).catch(() => {});
          sendEscalationTelegram(escalationHandoff).catch(() => {});
        }

        const validChunkIds = isAdmin
          ? new Set(chunksForTurn.map((c) => c.id.toLowerCase()))
          : new Set<string>();
        const sanitizedMessage = stripInvalidCitationMarkers(
          responseToSend.message,
          validChunkIds
        );
        responseToSend = { ...responseToSend, message: sanitizedMessage };
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && "content" in lastMsg) {
          (lastMsg as { content: string }).content = sanitizedMessage;
        }

        const citations = isAdmin ? buildCitations(responseToSend.message, chunksForTurn) : [];

        const responsePayload = {
          sessionId,
          message: responseToSend.message,
          message_html: responseToSend.message_html,
          phase: responseToSend.phase,
          requests: responseToSend.requests,
          resolution: responseToSend.resolution,
          escalation_reason: responseToSend.escalation_reason,
          citations: isAdmin && citations.length > 0 ? citations : undefined,
        };
        audit.logSessionState("after", {
          phase,
          turnCount,
          status,
          machineModel: session.machineModel,
          playbookId: session.playbookId,
          evidenceKeys: Object.keys(evidence),
          hypothesesCount: hypotheses.length,
        });
        sendEvent(controller, "message", JSON.stringify(responsePayload));
        closeController(controller);
      } catch (err) {
        console.error("[chat] fatal route error", err);
        await logErrorEvent({
          level: "error",
          route: "/api/chat",
          sessionId: sessionIdForError,
          message: "Fatal error while processing chat request.",
          error: err,
          context: {
            inputSource,
            imageCount: imageBuffers.length,
            isAuthenticated,
            userRole: authSession?.user?.role ?? null,
            phase: sessionForError?.phase ?? null,
            turnCount: turnCountForError,
          },
        }).catch(() => {});
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = rawMsg?.trim() ? rawMsg : "Unexpected chat error.";
        audit?.logError(msg);
        if (isAuthenticated) {
          sendEvent("error", JSON.stringify({ error: msg }));
          closeController(controller);
          return;
        }

        try {
          const escalationPayload = await escalateOnTechnicalFailure({
            existingSession: sessionForError,
            sessionId: sessionIdForError,
            userName: sessionForError?.userName ?? userName,
            userPhone: sessionForError?.userPhone ?? userPhone,
            machineModel: sessionForError?.machineModel ?? machineModelForError,
            playbookId: sessionForError?.playbookId ?? playbookIdForError,
            turnCount: turnCountForError,
            messages: messagesForError,
            evidence: evidenceForError,
            hypotheses: hypothesesForError,
            technicalDifficultiesMessage,
            technicalDifficultiesMessageHtml,
          });
          sendEvent(
            "message",
            JSON.stringify({
              sessionId: escalationPayload.sessionId,
              message: escalationPayload.message,
              message_html: escalationPayload.message_html,
              phase: "escalated",
              requests: [],
              escalation_reason: escalationPayload.escalationReason,
            })
          );
        } catch (escalationErr) {
          console.error("[chat] technical-failure escalation failed", escalationErr);
          await logErrorEvent({
            level: "error",
            route: "/api/chat",
            sessionId: sessionIdForError,
            message: "Technical-failure escalation fallback was triggered.",
            error: escalationErr,
            context: {
              isAuthenticated,
              phase: sessionForError?.phase ?? null,
              turnCount: turnCountForError,
            },
          }).catch(() => {});
          sendEvent(
            "message",
            JSON.stringify({
              sessionId: sessionIdForError ?? crypto.randomUUID(),
              message: technicalDifficultiesMessage,
              message_html: technicalDifficultiesMessageHtml,
              phase: "escalated",
              requests: [],
              escalation_reason: TECHNICAL_DIFFICULTIES_ESCALATION_REASON,
            })
          );
        }
        closeController(controller);
      } finally {
        releaseTurnKey(turnKeyForRelease);
        audit?.flush().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
