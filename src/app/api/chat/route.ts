import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
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
import { DIAGNOSTIC_CONFIG, TRIAGE_CONFIG } from "@/lib/config";
import { ensureNameplateTables } from "@/lib/db/ensure-nameplate-tables";
import { ensureClearanceTables } from "@/lib/db/ensure-clearance-tables";
import {
  writeStorageFile,
  readStorageFile,
  diagnosticSessionImagePath,
} from "@/lib/storage";
import { buildEscalationHandoff, sendEscalationWebhook } from "@/lib/escalation";
import { runPlaybookTriage, type TriageHistoryItem } from "@/lib/pipeline/playbook-triage";
import {
  analyzeNameplate,
  parseManufacturingYear,
  validateModel,
} from "@/lib/pipeline/nameplate-analysis";
import { AuditLogger } from "@/lib/audit";

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

type InputSource = "chat" | "structured" | "skip" | "note";

function buildVerificationRequest(): PlannerOutput["requests"][number] {
  return {
    type: "question",
    id: VERIFICATION_REQUEST_ID,
    prompt: "Did that fix the issue?",
    expectedInput: {
      type: "boolean",
      options: [...VERIFICATION_REQUEST_OPTIONS],
    },
  };
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: string) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
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

function countConsecutiveSkipTurns(messages: ChatMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (isSkipSignal(msg.content)) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function messageContainsEscalationIntent(content: string): boolean {
  const normalized = normalizeUserMessage(content);
  if (!normalized) return false;
  return (
    /\b(talk to (a )?(person|human|agent|technician|support))\b/.test(normalized) ||
    /\b(connect me|escalat(e|ion)|real person|human support)\b/.test(normalized) ||
    /\b(this isn't helping|not helping|this is not helping|frustrat(ed|ing))\b/.test(normalized)
  );
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
  await ensureNameplateTables();
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
  await ensureClearanceTables();
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

export async function POST(request: Request) {
  const formData = await request.formData();
  const sessionIdRaw = (formData.get("sessionId") as string)?.trim() || null;
  const message = (formData.get("message") as string)?.trim() ?? "";
  const inputSourceRaw = (formData.get("inputSource") as string)?.trim().toLowerCase() ?? "";
  const inputSource: InputSource =
    inputSourceRaw === "structured" ||
    inputSourceRaw === "skip" ||
    inputSourceRaw === "note"
      ? inputSourceRaw
      : "chat";
  const machineModel = (formData.get("machineModel") as string)?.trim() || null;
  const files = formData.getAll("images") as File[];

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message must be at most ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const session = await getSessionFromRequest(request);
  const isAdmin = session?.user?.role === "admin";

  // Per-session rate limit (skip when admin is logged in, e.g. for testing)
  if (sessionIdRaw && !isAdmin) {
    const { chatPerSession } = RATE_LIMITS;
    const result = checkRateLimit(
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
      const sendEvent = (
        ...args:
          | [string, string]
          | [ReadableStreamDefaultController<Uint8Array>, string, string]
      ) => {
        const event = args.length === 3 ? args[1] : args[0];
        const data = args.length === 3 ? args[2] : args[1];
        if (event === "message") {
          try {
            audit?.logApiResponse(JSON.parse(data));
          } catch {
            audit?.logApiResponse(data);
          }
        }
        send(controller, event, data);
      };
      try {
        await ensureNameplateTables();
        await ensureClearanceTables();
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
            sendEvent("error", JSON.stringify({ error: "Session not found." }));
            controller.close();
            return;
          }
          sessionId = session.id;
        }

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

          if (hasSubstantiveIssue) {
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
          }
        }

        if (session.phase === "nameplate_check") {
          audit.logPhasePath("nameplate_check");
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_nameplate }));
          const { instructionText, guideImages } = await getNameplatePrompt();

          if (imageBuffers.length === 0 && isSkipSignal(message)) {
            const escalationMessage =
              "We need the machine name plate to proceed with diagnosis. I'm connecting you with a technician who can help without it.";
            messages.push({
              role: "assistant",
              content: escalationMessage,
              timestamp: new Date().toISOString(),
            });
            const evidence = (session.evidence as Record<string, unknown>) ?? {};
            const hypotheses = (session.hypotheses as unknown[]) ?? [];
            const escalationHandoff = buildEscalationHandoff({
              sessionId,
              machineModel: session.machineModel ?? null,
              escalationReason: "User does not have a photo of the machine name plate.",
              playbookTitle: "Pre-diagnosis",
              labelId: "nameplate_skip",
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
                escalationReason: "User does not have a photo of the machine name plate.",
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
                phase: "escalated",
                requests: [],
                escalation_reason: "User does not have a photo of the machine name plate.",
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            sendEscalationWebhook(escalationHandoff).catch(() => {});
            controller.close();
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
          }

          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.analysing_photos }));

          const unsupportedMessage =
            "Your machine isn't a Spaceman machine. We only support Spaceman machines.";

          try {
            const extracted = await analyzeNameplate(imageBuffers, audit);
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
            }

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
                  model: session.machineModel ?? undefined,
                  serialNumber: session.serialNumber ?? undefined,
                  productType: session.productType ?? undefined,
                  playbookId: session.playbookId ?? undefined,
                })
              );
              controller.close();
              return;
            }

            const manufacturingYear = parseManufacturingYear(extractedSerial);
          if (manufacturingYear == null) {
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
          }
          const currentYear = new Date().getFullYear();
          const isOlderThanFiveYears =
            currentYear - manufacturingYear > 5;
          if (isOlderThanFiveYears) {
            const escalationMessage =
              "This machine appears to be more than 5 years old, so I'm connecting you with a technical specialist.";
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
                escalationReason: "Machine is more than 5 years old based on serial number.",
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
                escalation_reason: "Machine is more than 5 years old based on serial number.",
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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

          session = {
            ...session,
            machineModel: canonical,
            serialNumber: extractedSerial,
            manufacturingYear,
            triageHistory,
            phase: "product_type_check",
            status: "active",
          };

          sendEvent(
            controller,
            "message",
            JSON.stringify({
              sessionId,
              message: responseMessage,
              phase: "product_type_check",
              requests: assistantTurn.requests,
              model: session.machineModel ?? undefined,
              serialNumber: session.serialNumber ?? undefined,
              productType: session.productType ?? undefined,
              playbookId: session.playbookId ?? undefined,
            })
          );
          controller.close();
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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
              model: session.machineModel ?? undefined,
              serialNumber: session.serialNumber ?? undefined,
              productType: session.productType ?? undefined,
              playbookId: session.playbookId ?? undefined,
            })
          );
          controller.close();
          return;
        }

        if (session.phase === "clearance_check") {
          audit.logPhasePath("clearance_check");
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_clearance }));
          const { instructionText, guideImages } = await getClearancePrompt();

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
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
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
          const triageResult = await runPlaybookTriage({
            labels: triageLabels,
            triageHistory: nextTriageHistory,
            imageBuffers: allTriageImageBuffers,
            currentProductType: session.productType,
          }, audit);
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
            triageResult.confidence >= TRIAGE_CONFIG.autoSelectThreshold;
          const canConfirmSelect =
            !!matchedPlaybook &&
            triageRound >= TRIAGE_CONFIG.maxRounds &&
            triageResult.confidence >= TRIAGE_CONFIG.confirmThreshold;

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
            const shouldEscalate = triageRound >= TRIAGE_CONFIG.maxRounds;
            const responseMessage = shouldEscalate
              ? "I still can't confidently identify the right playbook from the provided details. I'm connecting you with a technician."
              : followUpQuestion;
            const responsePhase = shouldEscalate ? "escalated" : "triaging";
            const assistantTurn: ChatMessage & { requests?: PlannerOutput["requests"] } = {
              role: "assistant",
              content: responseMessage,
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
                phase: responsePhase,
                requests: assistantTurn.requests,
                escalation_reason: shouldEscalate
                  ? "Unable to confidently identify a playbook after triage follow-ups."
                  : undefined,
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                productType: session.productType ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
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
          sendEvent("error", JSON.stringify({ error: "No playbook found for this session." }));
          controller.close();
          return;
        }

        const playbook: DiagnosticPlaybook = {
          id: playbookRow.id,
          labelId: playbookRow.labelId,
          title: playbookRow.title,
          steps: (playbookRow.steps as DiagnosticPlaybook["steps"]) ?? [],
          symptoms: playbookRow.symptoms as DiagnosticPlaybook["symptoms"],
          evidenceChecklist: playbookRow.evidenceChecklist as DiagnosticPlaybook["evidenceChecklist"],
          candidateCauses: playbookRow.candidateCauses as DiagnosticPlaybook["candidateCauses"],
          diagnosticQuestions: playbookRow.diagnosticQuestions as DiagnosticPlaybook["diagnosticQuestions"],
          escalationTriggers: playbookRow.escalationTriggers as DiagnosticPlaybook["escalationTriggers"],
        };

        const evidence = (session.evidence as Record<string, EvidenceRecord>) ?? {};
        let hypotheses = (session.hypotheses as HypothesisState[]) ?? [];
        let phase = session.phase;
        let turnCount = session.turnCount + 1;

        const lastAssistantMessage = messages.filter((m) => m.role === "assistant").pop();
        const outstandingRequestIds =
          (lastAssistantMessage as { requests?: { id: string }[] } | undefined)?.requests?.map(
            (r) => r.id
          ) ?? [];
        const lastUserWasSkip = inputSource === "skip" || isSkipSignal(message);
        const skipEvidenceIds = (playbook.evidenceChecklist ?? [])
          .map((item) => item.id)
          .filter((id) => outstandingRequestIds.includes(id));
        const escalationOfferOutstanding = outstandingRequestIds.includes(ESCALATION_OFFER_REQUEST_ID);
        const userAskedForEscalationInNote =
          inputSource === "note" && messageContainsEscalationIntent(message);

        let plannerOutput: PlannerOutput;
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
                const verificationRequest = buildVerificationRequest();
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
                    model: session.machineModel ?? undefined,
                    serialNumber: session.serialNumber ?? undefined,
                    productType: session.productType ?? undefined,
                    playbookId: session.playbookId ?? undefined,
                  })
                );
                controller.close();
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
                    model: session.machineModel ?? undefined,
                    serialNumber: session.serialNumber ?? undefined,
                    productType: session.productType ?? undefined,
                    playbookId: session.playbookId ?? undefined,
                  })
                );
                controller.close();
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
                  model: session.machineModel ?? undefined,
                  serialNumber: session.serialNumber ?? undefined,
                  productType: session.productType ?? undefined,
                  playbookId: session.playbookId ?? undefined,
                })
              );
              controller.close();
              return;
            }
          }

          // Either already have outcome or ambiguous message — answer as follow-up
          sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.searching_manuals }));
          const queryText = message;
          const keywordQuery = `${playbook.labelId} troubleshooting steps causes`;
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
            followUpMessage = await runFollowUpAnswer({
              recentMessages: messages.slice(0, -1),
              docChunks: chunksForTurn,
              lastUserMessage: message,
              resolution: lastResolution,
              machineModel: session.machineModel ?? undefined,
              imageBuffers: imageBuffersForLlm.length > 0 ? imageBuffersForLlm : undefined,
            }, audit);
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
                message: "Understood. I'm connecting you with a technician now.",
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
            const overSafetyTurnCap = turnCount > DIAGNOSTIC_CONFIG.maxTurns;

            if (escalationFromTrigger.triggered) {
              phase = "escalated";
              plannerOutput = {
                message: `For your safety we're connecting you with a technician. ${escalationFromTrigger.matched?.reason ?? "Please describe what you're seeing to support."}`,
                phase: "escalated",
                requests: [],
                hypotheses_update: hypotheses,
                evidence_extracted: [],
                escalation_reason: escalationFromTrigger.matched?.reason ?? "Safety trigger detected",
              };
            } else if (overSafetyTurnCap) {
              phase = "escalated";
              plannerOutput = {
                message: "This session has reached its maximum length. Connecting you with a technician who can help further.",
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
            const plannerLastUserMessage = lastUserWasSkip
              ? `User replied "I don't know" and skipped answering outstanding request IDs: ${outstandingRequestIds.join(", ") || "(none)"}.`
              : userAskedForEscalationInNote
                ? `${plannerUserMessage}\n\n[Context: user entered this in the optional note field and appears to be asking for human help. Show empathy, try one alternate troubleshooting path before escalating unless unsafe.]`
                : plannerUserMessage;
            const queryText = `${plannerLastUserMessage} ${playbook.labelId} troubleshooting steps causes`;
            const queryEmbedding = await openaiTextEmbedder.embed(queryText);
            const chunks = await searchDocChunks(
              queryEmbedding,
              8,
              session.machineModel ?? undefined,
              undefined,
              plannerLastUserMessage
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

            sendEvent("stage", JSON.stringify({ message: STAGE_MESSAGES.thinking }));
            plannerOutput = await runDiagnosticPlanner({
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
            }, audit);

            const { output: sanitized, errors: sanitizeErrors } = validateAndSanitizePlannerOutput(
              plannerOutput,
              playbook,
              actionsById,
              true
            );
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
          const verificationSuffix = "\n\nAfter trying these steps, please let me know: did that fix the issue?";
          const verificationRequest = buildVerificationRequest();
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
          consecutiveSkips >= DIAGNOSTIC_CONFIG.consecutiveSkipsBeforeEscalationOffer &&
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

        // If planner left us in "diagnosing" with no requests and we have substantial evidence, force escalation so the user gets a clear outcome instead of being stuck
        const evidenceCount = Object.keys(evidence).length;
        const diagnosingWithNoNextStep =
          phase === "diagnosing" &&
          plannerOutput.requests.length === 0 &&
          evidenceCount >= 5;
        if (diagnosingWithNoNextStep && status === "active") {
          phase = "escalated";
          status = "escalated";
          escalationReason =
            "We weren't able to pinpoint the cause from the information provided. Connecting you with a technician who can help further.";
          responseToSend = {
            ...plannerOutput,
            message: escalationReason,
            phase: "escalated",
            requests: [],
            escalation_reason: escalationReason,
          };
          messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            content: escalationReason,
          } as ChatMessage & { requests?: PlannerOutput["requests"] };
        }

        const lastEvidenceTurn = Math.max(
          0,
          ...Object.values(evidence).map((r) => r.turn)
        );
        const stallEscalation =
          turnCount >= 2 &&
          plannerOutput.evidence_extracted.length === 0 &&
          turnCount - lastEvidenceTurn >= DIAGNOSTIC_CONFIG.stallTurnsWithoutNewEvidence;
        if (stallEscalation && status === "active") {
          status = "escalated";
          phase = "escalated";
          escalationReason = "No new evidence for several turns; connecting you with support.";
          responseToSend = {
            ...plannerOutput,
            message: escalationReason,
            phase: "escalated",
            requests: [],
            escalation_reason: escalationReason,
          };
          const stallMessage: ChatMessage = {
            role: "assistant",
            content: escalationReason,
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
            machineModel: session.machineModel ?? null,
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
            updatedAt: new Date(),
          })
          .where(eq(diagnosticSessions.id, sessionId));

        if (escalationHandoff) {
          // Fire-and-forget: don't block the response
          sendEscalationWebhook(escalationHandoff).catch(() => {});
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
          phase: responseToSend.phase,
          requests: responseToSend.requests,
          resolution: responseToSend.resolution,
          escalation_reason: responseToSend.escalation_reason,
          citations: isAdmin && citations.length > 0 ? citations : undefined,
          model: session.machineModel ?? undefined,
          serialNumber: session.serialNumber ?? undefined,
          productType: session.productType ?? undefined,
          playbookId: session.playbookId ?? undefined,
          playbookTitle: playbook?.title ?? undefined,
          playbookLabelId: playbook?.labelId ?? undefined,
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
        controller.close();
      } catch (err) {
        console.error("[chat] fatal route error", err);
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = rawMsg?.trim() ? rawMsg : "Unexpected chat error.";
        audit?.logError(msg);
        sendEvent("error", JSON.stringify({ error: msg }));
        controller.close();
      } finally {
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
