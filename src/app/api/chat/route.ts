import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  diagnosticSessions,
  playbooks,
  actions,
  sessionEvents,
  sessionOutcomes,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { clipEmbedder, getConfiguredClipProvider } from "@/lib/embeddings/clip";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import {
  searchReferenceImages,
  aggregateLabelScores,
} from "@/lib/pipeline/image-retrieval";
import { searchDocChunks } from "@/lib/pipeline/text-retrieval";
import {
  runFollowUpAnswer,
  validateAndSanitizePlannerOutput,
  type DiagnosticPlaybook,
  type ChatMessage,
  type EvidenceRecord,
  type HypothesisState,
  type PlannerOutput,
  type ActionRecord,
} from "@/lib/pipeline/diagnostic-planner";
import { replaceWithCanonicalAndSort } from "@/lib/pipeline/validate-grounding";
import { DIAGNOSTIC_CONFIG } from "@/lib/config";
import {
  writeStorageFile,
  diagnosticSessionImagePath,
} from "@/lib/storage";
import { createHash } from "crypto";
import {
  hasSufficientEvidence,
  runDeterministicPlanner,
  suggestNextActions,
} from "@/lib/diagnostics/controller";
import {
  evaluatePrePlannerEscalation,
  evaluatePostPlannerEscalation,
} from "@/lib/diagnostics/escalation-policy";

const STAGE_MESSAGES: Record<string, string> = {
  analysing_photos: "Analysing your photos…",
  finding_similar: "Finding similar examples…",
  selecting_playbook: "Selecting diagnostic guide…",
  searching_manuals: "Searching knowledge base…",
  thinking: "Thinking…",
};

function tokenizeForRouting(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
}

function tokenMatchesRouteToken(userToken: string, candidateToken: string): boolean {
  if (userToken === candidateToken) return true;
  if (userToken.length >= 4 && candidateToken.length >= 4) {
    // Lightweight stemming by 4-char prefix handles runny/running and similar variants.
    return userToken.slice(0, 4) === candidateToken.slice(0, 4);
  }
  return false;
}

async function writeSessionEvent(params: {
  sessionId: string;
  turn: number;
  eventType: string;
  modelVersion?: string;
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
  evidenceDelta?: unknown;
  hypothesisDelta?: unknown;
  citations?: unknown;
}) {
  const promptHash = createHash("sha256")
    .update(JSON.stringify(params.inputSnapshot ?? {}))
    .digest("hex");
  await db.insert(sessionEvents).values({
    sessionId: params.sessionId,
    turn: params.turn,
    eventType: params.eventType,
    promptHash,
    modelVersion: params.modelVersion,
    inputSnapshot: (params.inputSnapshot ?? null) as Record<string, unknown> | null,
    outputSnapshot: (params.outputSnapshot ?? null) as Record<string, unknown> | null,
    evidenceDelta: (params.evidenceDelta ?? null) as Record<string, unknown> | null,
    hypothesisDelta: (params.hypothesisDelta ?? null) as Record<string, unknown> | null,
    citations: (params.citations ?? null) as Record<string, unknown> | null,
  });
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
            const provider = getConfiguredClipProvider();
            for (const buf of imageBuffers) {
              const emb = await clipEmbedder.embed(buf);
              imageEmbeddings.push(emb);
            }
            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.finding_similar }));
            const allMatches = [];
            for (const emb of imageEmbeddings) {
              const matches = await searchReferenceImages(
                emb,
                undefined,
                provider ?? undefined
              );
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
          if (!playbookId) {
            const allPlaybooks = await db.select().from(playbooks);
            const text = message.toLowerCase();
            const userTokens = tokenizeForRouting(text);
            let best: { id: string; score: number } | null = null;
            for (const pb of allPlaybooks) {
              const symptoms = (pb.symptoms as { description?: string }[] | null) ?? [];
              const score = symptoms.reduce((acc, s) => {
                const desc = (s.description ?? "").toLowerCase();
                if (!desc) return acc;
                const tokens = tokenizeForRouting(desc);
                const matched = tokens.some((candidate) =>
                  userTokens.some((u) => tokenMatchesRouteToken(u, candidate))
                );
                return matched ? acc + 1 : acc;
              }, 0);
              if (!best || score > best.score) best = { id: pb.id, score };
            }
            if (best) playbookId = best.id;
            if (!playbookId) {
              const [firstPlaybook] = await db.select().from(playbooks).limit(1);
              if (firstPlaybook) playbookId = firstPlaybook.id;
            }
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
        let newImageEvidenceSummary: string | undefined;
        if (imageBuffers.length > 0 && sessionId) {
          for (let i = 0; i < imageBuffers.length; i++) {
            const relPath = diagnosticSessionImagePath(
              sessionId,
              `turn_${messages.length / 2}_${i}.jpg`
            );
            await writeStorageFile(relPath, imageBuffers[i]);
            imagePaths.push(relPath);
          }
          const provider = getConfiguredClipProvider();
          if (provider) {
            const allMatches = [];
            for (const buf of imageBuffers) {
              const emb = await clipEmbedder.embed(buf);
              const matches = await searchReferenceImages(
                emb,
                5,
                provider
              );
              allMatches.push(...matches);
            }
            const scores = aggregateLabelScores(allMatches);
            newImageEvidenceSummary = scores
              .slice(0, 3)
              .map((s) => `${s.labelId}: ${s.score.toFixed(3)}`)
              .join("; ");
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
        const canonicalMachineModel = machineModel ?? session.machineModel ?? null;

        // If model is known from the dedicated header field, satisfy machine model evidence up front.
        if (canonicalMachineModel) {
          const modelEvidenceItem = (playbook.evidenceChecklist ?? []).find(
            (item) =>
              item.id === "machine_model" ||
              /machine model/i.test(item.id) ||
              /machine model/i.test(item.description ?? "")
          );
          if (modelEvidenceItem && !(modelEvidenceItem.id in evidence)) {
            evidence[modelEvidenceItem.id] = {
              value: canonicalMachineModel,
              type: "string",
              confidence: "exact",
              collectedAt: new Date().toISOString(),
              turn: turnCount,
            };
          }
        }

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

        // Post-resolution: answer follow-up questions with doc-backed reply, no resolution re-emit
        if (session.status === "resolved") {
          const lastResolution = (lastAssistantMessage as { resolution?: PlannerOutput["resolution"] } | undefined)?.resolution;
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
          const sufficiency = hasSufficientEvidence(playbook, evidence, 0.6);
          const preEscalation = evaluatePrePlannerEscalation({
            userMessage: message,
            triggers: playbook.escalationTriggers,
            turnCount,
            maxTurns: DIAGNOSTIC_CONFIG.maxTurns,
            evidence: {
              ratio: sufficiency.ratio,
              requiredCount: sufficiency.requiredCount,
              collectedRequired: sufficiency.collectedRequired,
            },
          });

          if (preEscalation) {
            phase = "escalated";
            plannerOutput = {
              message: preEscalation.assistantMessage,
              phase: "escalated",
              requests: [],
              hypotheses_update: hypotheses,
              evidence_extracted: [],
              escalation_reason: preEscalation.escalationReason,
            };
          } else {
            const relevantActions = await db.select().from(actions);
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
              session.machineModel ?? undefined,
              playbook.labelId,
              message
            );
            chunksForTurn = chunks.map((c) => ({
              id: c.id,
              content: c.content,
              metadata: c.metadata,
              documentId: c.documentId,
            }));

            send(controller, "stage", JSON.stringify({ message: STAGE_MESSAGES.thinking }));
            plannerOutput = runDeterministicPlanner({
              playbook,
              evidence,
              hypotheses,
              lastUserMessage: message,
              outstandingRequestIds,
              actionsById,
            });

            const { output: sanitized } = validateAndSanitizePlannerOutput(
              plannerOutput,
              playbook,
              actionsById,
              true,
              evidence
            );
            plannerOutput = sanitized;
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

        // Serve canonical step text and sort by playbook order (steps run in order)
        if (
          phase === "resolving" &&
          plannerOutput.resolution?.steps?.length &&
          (playbook.steps?.length ?? 0) > 0
        ) {
          plannerOutput.resolution = {
            ...plannerOutput.resolution,
            steps: replaceWithCanonicalAndSort(
              plannerOutput.resolution.steps.map((s) => ({
                step_id: s.step_id,
                instruction: s.instruction ?? "",
                check: s.check,
              })),
              playbook.steps
            ),
          };
        }

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

        const sufficiency = hasSufficientEvidence(playbook, evidence, 0.6);
        if (phase === "resolving" && !sufficiency.sufficient) {
          phase = "gathering_info";
          plannerOutput.phase = "gathering_info";
          plannerOutput.resolution = undefined;
          plannerOutput.message =
            `I need a bit more information before I can make a reliable diagnosis (${sufficiency.collectedRequired}/${sufficiency.requiredCount} required checks complete). ` +
            plannerOutput.message;
        }

        let status = session.status;
        let resolvedCauseId: string | null = null;
        let escalationReason: string | null = null;
        if (phase === "resolving") {
          status = "resolved";
          resolvedCauseId = plannerOutput.resolution?.causeId ?? null;
        } else if (phase === "escalated") {
          status = "escalated";
          escalationReason = plannerOutput.escalation_reason ?? null;
        }

        let responseToSend = plannerOutput;

        const lastEvidenceTurn = Math.max(
          0,
          ...Object.values(evidence).map((r) => r.turn)
        );
        const sufficiencyForPolicy = hasSufficientEvidence(playbook, evidence, 0.6);
        const postEscalation = evaluatePostPlannerEscalation({
          turnCount,
          evidence: {
            ratio: sufficiencyForPolicy.ratio,
            requiredCount: sufficiencyForPolicy.requiredCount,
            collectedRequired: sufficiencyForPolicy.collectedRequired,
          },
          plannerPhase: phase,
          plannerRequestsCount: plannerOutput.requests.length,
          newEvidenceCount: plannerOutput.evidence_extracted.length,
          lastEvidenceTurn,
          stallTurnsWithoutNewEvidence: DIAGNOSTIC_CONFIG.stallTurnsWithoutNewEvidence,
          requiredEvidenceTurnsBeforeEscalation:
            DIAGNOSTIC_CONFIG.requiredEvidenceTurnsBeforeEscalation,
        });
        if (postEscalation && status === "active") {
          status = "escalated";
          phase = "escalated";
          escalationReason = postEscalation.escalationReason;
          responseToSend = {
            ...plannerOutput,
            message: postEscalation.assistantMessage,
            phase: "escalated",
            requests: [],
            escalation_reason: escalationReason,
          };
          const updatedEscalationMessage: ChatMessage = {
            role: "assistant",
            content: postEscalation.assistantMessage,
            timestamp: new Date().toISOString(),
          };
          messages[messages.length - 1] = updatedEscalationMessage;
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
            machineModel: canonicalMachineModel,
            resolvedCauseId,
            escalationReason,
            updatedAt: new Date(),
          })
          .where(eq(diagnosticSessions.id, sessionId));

        if (
          phase === "resolved_followup" &&
          /^(yes|no|fixed|not fixed|resolved|unresolved)$/i.test(message.trim())
        ) {
          await db.insert(sessionOutcomes).values({
            sessionId,
            outcomeType: /^(yes|fixed|resolved)$/i.test(message.trim())
              ? "resolved_correct"
              : "resolved_incorrect",
            userFeedback: message.trim(),
          });
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
            evidence_progress: {
              collected_required: sufficiencyForPolicy.collectedRequired,
              required_total: sufficiencyForPolicy.requiredCount,
              ratio: sufficiencyForPolicy.ratio,
            },
            citations: citations.length > 0 ? citations : undefined,
          })
        );
        await writeSessionEvent({
          sessionId,
          turn: turnCount,
          eventType: "assistant_response",
          modelVersion: "gpt-4o",
          inputSnapshot: {
            message,
            phaseBefore: session.phase,
            machineModel: session.machineModel,
          },
          outputSnapshot: responseToSend,
          evidenceDelta: plannerOutput.evidence_extracted,
          hypothesisDelta: plannerOutput.hypotheses_update,
          citations,
        });
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
