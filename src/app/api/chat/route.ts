import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  diagnosticSessions,
  playbooks,
  actions,
  labels,
  nameplateConfig,
  nameplateGuideImages,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
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
import {
  writeStorageFile,
  diagnosticSessionImagePath,
} from "@/lib/storage";
import { buildEscalationHandoff, sendEscalationWebhook } from "@/lib/escalation";
import { runPlaybookTriage, type TriageHistoryItem } from "@/lib/pipeline/playbook-triage";
import {
  analyzeNameplate,
  parseManufacturingYear,
  validateModel,
} from "@/lib/pipeline/nameplate-analysis";

const STAGE_MESSAGES: Record<string, string> = {
  requesting_nameplate: "Collecting machine details…",
  selecting_playbook: "Selecting diagnostic guide…",
  asking_followup: "Asking a follow-up question…",
  analysing_photos: "Analysing your photos…",
  searching_manuals: "Searching knowledge base…",
  thinking: "Thinking…",
};

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

export async function POST(request: Request) {
  const formData = await request.formData();
  const sessionIdRaw = (formData.get("sessionId") as string)?.trim() || null;
  const message = (formData.get("message") as string)?.trim() ?? "";
  const machineModel = (formData.get("machineModel") as string)?.trim() || null;
  const files = formData.getAll("images") as File[];

  const imageBuffers: Buffer[] = [];
  for (const file of files) {
    if (file && file.size > 0) {
      imageBuffers.push(Buffer.from(await file.arrayBuffer()));
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await ensureNameplateTables();
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
            send(controller, "error", JSON.stringify({ error: "Session not found." }));
            controller.close();
            return;
          }
          sessionId = session.id;
        }

        const messages = (session!.messages as ChatMessage[]) ?? [];
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
        if (hasUserInput) {
          messages.push({
            role: "user",
            content: message || "(sent photos)",
            images: imagePaths.length ? imagePaths : undefined,
            timestamp: new Date().toISOString(),
          });
        }

        if (session.phase === "collecting_issue") {
          const { instructionText, guideImages } = await getNameplatePrompt();
          const hasSubstantiveIssue =
            Boolean(message) &&
            !isPlaceholderUserMessage(message) &&
            !isTrivialMessage(message);

          if (hasSubstantiveIssue) {
            console.log(
              `[chat] phase: collecting_issue -> nameplate_check (session=${sessionId}) symptom="${message.trim().slice(0, 60)}${message.length > 60 ? "…" : ""}"`
            );
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_nameplate }));
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

            send(
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
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.asking_followup }));
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
            send(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: responseMessage,
                phase: "collecting_issue",
                requests: assistantTurn.requests,
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
          }
        }

        if (session.phase === "nameplate_check") {
          send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.requesting_nameplate }));
          const { instructionText, guideImages } = await getNameplatePrompt();

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

            send(
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
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
          }

          send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.analysing_photos }));

          const unsupportedMessage =
            "Your machine isn't a Spaceman machine. We only support Spaceman machines.";

          try {
            const extracted = await analyzeNameplate(imageBuffers);
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

            send(
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

              send(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: unsupportedMessage,
                  phase: "unsupported_model",
                  requests: [],
                  model: session.machineModel ?? undefined,
                  serialNumber: session.serialNumber ?? undefined,
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

            send(
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

            send(
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
            `[chat] phase: nameplate_check -> triaging (session=${sessionId}) triageHistory items=${triageHistory.length} user_preview="${triagePreview}${triagePreview.length >= 80 ? "…" : ""}"`
          );

          await db
            .update(diagnosticSessions)
            .set({
              machineModel: canonical,
              serialNumber: extractedSerial,
              manufacturingYear,
              triageHistory,
              phase: "triaging",
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
            phase: "triaging",
            status: "active",
          };
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
            send(
              controller,
              "message",
              JSON.stringify({
                sessionId,
                message: unsupportedMessage,
                phase: "unsupported_model",
                requests: [],
                model: session.machineModel ?? undefined,
                serialNumber: session.serialNumber ?? undefined,
                playbookId: session.playbookId ?? undefined,
              })
            );
            controller.close();
            return;
          }
        }

        const isTriageFlow = session.phase === "triaging";
        if (isTriageFlow) {
          send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.selecting_playbook }));
          if (imageBuffers.length > 0) {
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.analysing_photos }));
          }

          const allPlaybooks = await db
            .select({ id: playbooks.id, labelId: playbooks.labelId, title: playbooks.title })
            .from(playbooks);
          const allLabels = await db.select().from(labels);
          const labelsById = new Map(allLabels.map((l) => [l.id, l]));
          const triageLabels = allPlaybooks.map((pb) => {
            const labelMeta = labelsById.get(pb.labelId);
            return {
              labelId: pb.labelId,
              playbookTitle: pb.title,
              displayName: labelMeta?.displayName ?? pb.labelId,
              description: labelMeta?.description ?? null,
            };
          });

          triageRound += 1;
          const nextTriageHistory: TriageHistoryItem[] = [
            ...triageHistory,
            { role: "user", content: message || "(sent photos)" },
          ];
          const triageResult = await runPlaybookTriage({
            labels: triageLabels,
            triageHistory: nextTriageHistory,
            imageBuffers: imageBuffers.length > 0 ? imageBuffers : undefined,
          });
          console.log(
            `[chat] triage (session=${sessionId}) selected_label=${triageResult.selectedLabelId ?? "null"} confidence=${triageResult.confidence.toFixed(2)} candidates=[${triageResult.candidateLabels.join(", ")}]`
          );

          const matchedPlaybook = triageResult.selectedLabelId
            ? allPlaybooks.find((pb) => pb.labelId === triageResult.selectedLabelId)
            : null;
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
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.asking_followup }));

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

            send(
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
          send(controller, "error", JSON.stringify({ error: "No playbook found for this session." }));
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

        let plannerOutput: PlannerOutput;
        let chunksForTurn: {
          id: string;
          content: string;
          metadata?: unknown;
          documentId?: string;
        }[] = [];

        // Post-resolution: capture verification feedback, then answer follow-ups
        if (session.status === "resolved") {
          const lastResolution = (lastAssistantMessage as { resolution?: PlannerOutput["resolution"] } | undefined)?.resolution;
          const hasOutcome = session.resolutionOutcome != null;

          // Parse verification feedback from user's message
          if (!hasOutcome) {
            const lower = message.toLowerCase();
            const positive = /\b(yes|fixed|worked|resolved|better|good|great|perfect|thanks|thank)\b/.test(lower);
            const negative = /\b(no|not fixed|didn'?t work|still|same|worse|problem)\b/.test(lower);
            const partial = /\b(partially|somewhat|a bit|little|slightly)\b/.test(lower);

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
              // Ambiguous — treat as follow-up question, ask for verification
              outcome = "";
              responseMessage = "";
            }

            if (outcome) {
              await db
                .update(diagnosticSessions)
                .set({ resolutionOutcome: outcome, updatedAt: new Date() })
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

                send(
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

              send(
                controller,
                "message",
                JSON.stringify({
                  sessionId,
                  message: responseMessage,
                  phase: "resolved_followup",
                  requests: [],
                  model: session.machineModel ?? undefined,
                  serialNumber: session.serialNumber ?? undefined,
                  playbookId: session.playbookId ?? undefined,
                })
              );
              controller.close();
              return;
            }
          }

          // Either already have outcome or ambiguous message — answer as follow-up
          send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.searching_manuals }));
          const queryText = `${message} ${playbook.labelId} troubleshooting steps causes`;
          const queryEmbedding = await openaiTextEmbedder.embed(queryText);
          const chunks = await searchDocChunks(
            queryEmbedding,
            8,
            session.machineModel ?? undefined
          );
          chunksForTurn = chunks.map((c) => ({
            id: c.id,
            content: c.content,
            metadata: c.metadata,
            documentId: c.documentId,
          }));
          send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.thinking }));
          const followUpMessage = await runFollowUpAnswer({
            recentMessages: messages.slice(0, -1),
            docChunks: chunksForTurn,
            lastUserMessage: message,
            resolution: lastResolution,
            machineModel: session.machineModel ?? undefined,
            imageBuffers: imageBuffers.length > 0 ? imageBuffers : undefined,
          });
          phase = "resolved_followup";
          plannerOutput = {
            message: followUpMessage,
            phase: "resolved_followup",
            requests: [],
            hypotheses_update: hypotheses,
            evidence_extracted: [],
          };
        } else {
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

            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.searching_manuals }));
            const queryText = `${message} ${playbook.labelId} troubleshooting steps causes`;
            const queryEmbedding = await openaiTextEmbedder.embed(queryText);
            const chunks = await searchDocChunks(
              queryEmbedding,
              8,
              session.machineModel ?? undefined
            );
            chunksForTurn = chunks.map((c) => ({
              id: c.id,
              content: c.content,
              metadata: c.metadata,
              documentId: c.documentId,
            }));

            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.thinking }));
            plannerOutput = await runDiagnosticPlanner({
              playbook,
              evidence,
              hypotheses,
              phase,
              turnCount,
              recentMessages: messages.slice(0, -1),
              docChunks: chunksForTurn,
              actions: Array.from(actionsById.values()),
              lastUserMessage: message,
              machineModel: session.machineModel ?? undefined,
              outstandingRequestIds,
              imageBuffers: imageBuffers.length > 0 ? imageBuffers : undefined,
            });

            const { output: sanitized } = validateAndSanitizePlannerOutput(
              plannerOutput,
              playbook,
              actionsById,
              true
            );
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
        if (phase === "resolving") {
          status = "resolved";
          resolvedCauseId = plannerOutput.resolution?.causeId ?? null;
          // Append verification question
          const verificationSuffix = "\n\nAfter trying these steps, please let me know: did that fix the issue?";
          plannerOutput = {
            ...plannerOutput,
            message: plannerOutput.message + verificationSuffix,
          };
          assistantMessage.content = plannerOutput.message;
        } else if (phase === "escalated") {
          status = "escalated";
          escalationReason = plannerOutput.escalation_reason ?? null;
        }

        let responseToSend = plannerOutput;

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
            escalationHandoff: escalationHandoff ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(diagnosticSessions.id, sessionId));

        if (escalationHandoff) {
          // Fire-and-forget: don't block the response
          sendEscalationWebhook(escalationHandoff).catch(() => {});
        }

        const citations = buildCitations(responseToSend.message, chunksForTurn);

        send(
          controller,
          "message",
          JSON.stringify({
            sessionId,
            message: responseToSend.message,
            phase: responseToSend.phase,
            requests: responseToSend.requests,
            resolution: responseToSend.resolution,
            escalation_reason: responseToSend.escalation_reason,
            citations: citations.length > 0 ? citations : undefined,
            model: session.machineModel ?? undefined,
            serialNumber: session.serialNumber ?? undefined,
            playbookId: session.playbookId ?? undefined,
            playbookTitle: playbook?.title ?? undefined,
            playbookLabelId: playbook?.labelId ?? undefined,
          })
        );
        controller.close();
      } catch (err) {
        console.error("[chat] fatal route error", err);
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = rawMsg?.trim() ? rawMsg : "Unexpected chat error.";
        send(controller, "error", JSON.stringify({ error: msg }));
        controller.close();
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
