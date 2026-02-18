import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  diagnosticSessions,
  playbooks,
  actions,
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
            });

            const { output: sanitized } = validateAndSanitizePlannerOutput(
              plannerOutput,
              playbook,
              actionsById,
              true
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
            updatedAt: new Date(),
          })
          .where(eq(diagnosticSessions.id, sessionId));

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
