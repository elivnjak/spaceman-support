import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  diagnosticSessions,
  playbooks,
  actions,
  labels,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { clipEmbedder } from "@/lib/embeddings/clip";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import {
  searchReferenceImages,
  aggregateLabelScores,
} from "@/lib/pipeline/image-retrieval";
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
import { DIAGNOSTIC_CONFIG } from "@/lib/config";
import {
  writeStorageFile,
  diagnosticSessionImagePath,
} from "@/lib/storage";
import { buildEscalationHandoff, sendEscalationWebhook } from "@/lib/escalation";

const STAGE_MESSAGES: Record<string, string> = {
  analysing_photos: "Analysing your photos…",
  finding_similar: "Finding similar examples…",
  selecting_playbook: "Selecting diagnostic guide…",
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
        let session = sessionIdRaw
          ? (await db.select().from(diagnosticSessions).where(eq(diagnosticSessions.id, sessionIdRaw)))[0]
          : null;

        const isNewSession = !session;
        let sessionId: string;

        if (isNewSession) {
          send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.select_playbook }));
          let playbookId: string | null = null;
          let labelId: string | null = null;

          if (imageBuffers.length > 0) {
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.analysing_photos }));
            const imageEmbeddings: number[][] = [];
            for (const buf of imageBuffers) {
              const emb = await clipEmbedder.embed(buf);
              imageEmbeddings.push(emb);
            }
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.finding_similar }));
            const allMatches = [];
            for (const emb of imageEmbeddings) {
              const matches = await searchReferenceImages(emb);
              allMatches.push(...matches);
            }
            const labelScores = aggregateLabelScores(allMatches);
            if (labelScores.length > 0) {
              labelId = labelScores[0].labelId;
              const [pb] = await db
                .select()
                .from(playbooks)
                .where(eq(playbooks.labelId, labelId));
              if (pb) playbookId = pb.id;
            }
          }
          if (!playbookId && message.trim()) {
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.selecting_playbook }));
            const allPlaybooks = await db
              .select({ id: playbooks.id, labelId: playbooks.labelId, title: playbooks.title })
              .from(playbooks);
            const allLabels = await db.select().from(labels);

            if (allPlaybooks.length > 0) {
              const labelDescriptions = allLabels
                .map((l) => `- ${l.id}: ${l.displayName}${l.description ? ` (${l.description})` : ""}`)
                .join("\n");

              const OpenAI = (await import("openai")).default;
              const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
              const classRes = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content: `You classify user support messages into issue categories. Available categories:\n${labelDescriptions}\n\nRespond with JSON: {"label_id": "<category id>", "confidence": <0-1>}. If none clearly match, pick the closest.`,
                  },
                  { role: "user", content: message },
                ],
                response_format: { type: "json_object" },
              });
              const classText = classRes.choices[0]?.message?.content;
              if (classText) {
                try {
                  const parsed = JSON.parse(classText) as { label_id?: string };
                  if (parsed.label_id) {
                    labelId = parsed.label_id;
                    const matchedPb = allPlaybooks.find((pb) => pb.labelId === parsed.label_id);
                    if (matchedPb) playbookId = matchedPb.id;
                  }
                } catch { /* fall through to default */ }
              }
            }
          }
          if (!playbookId) {
            const [firstPlaybook] = await db.select().from(playbooks).limit(1);
            if (firstPlaybook) playbookId = firstPlaybook.id;
          }

          const [created] = await db
            .insert(diagnosticSessions)
            .values({
              status: "active",
              machineModel: machineModel ?? null,
              playbookId,
              messages: [],
              evidence: {},
              hypotheses: [],
              phase: "gathering_info",
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

        messages.push({
          role: "user",
          content: message,
          images: imagePaths.length ? imagePaths : undefined,
          timestamp: new Date().toISOString(),
        });

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
          })
        );
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
