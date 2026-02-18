import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/pipeline/analyse";
import { db } from "@/lib/db";
import { supportSessions, labels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const STAGE_MESSAGES: Record<string, string> = {
  analysing_photos: "Analysing your photos…",
  finding_similar: "Finding similar examples…",
  searching_manuals: "Searching manuals…",
  generating_steps: "Generating fix steps…",
};

type AnswerPair = { question: string; answer: string };

export async function POST(request: Request) {
  const formData = await request.formData();
  let userText = (formData.get("text") as string) ?? "";
  const sessionIdRaw = formData.get("sessionId") as string | null;
  const answersRaw = formData.get("answers") as string | null;
  const machineModel = (formData.get("machineModel") as string)?.trim() || null;
  const files = formData.getAll("images") as File[];
  const imageBuffers: Buffer[] = [];
  for (const file of files) {
    if (file && file.size > 0) {
      imageBuffers.push(Buffer.from(await file.arrayBuffer()));
    }
  }

  let parentSessionId: string | null = null;
  if (sessionIdRaw && answersRaw) {
    try {
      const answers = JSON.parse(answersRaw) as AnswerPair[];
      const [session] = await db
        .select({ userText: supportSessions.userText })
        .from(supportSessions)
        .where(eq(supportSessions.id, sessionIdRaw));
      if (session?.userText) {
        const followUpBlock = answers
          .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
          .join("\n\n");
        userText = `${session.userText}\n\nFollow-up answers:\n${followUpBlock}`;
        parentSessionId = sessionIdRaw;
      }
    } catch (_) {
      // ignore parse/load errors; proceed with original userText
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      function send(event: string, data: string) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      }

      try {
        const result = await runAnalysis({
          userText,
          imageBuffers,
          machineModel: machineModel ?? undefined,
          onStage: (stage: string) => {
            send("stage", JSON.stringify({ message: STAGE_MESSAGES[stage] ?? stage }));
          },
        });

        const predictedLabelId =
          result.predictedLabel === "unknown"
            ? null
            : (await db.query.labels.findFirst({
                where: eq(labels.id, result.predictedLabel),
                columns: { id: true },
              }))?.id ?? null;

        const [session] = await db
          .insert(supportSessions)
          .values({
            userText,
            imagePaths: [],
            predictedLabelId,
            confidence: result.confidence,
            result: result as unknown as Record<string, unknown>,
            parentSessionId,
            machineModel,
          })
          .returning();

        send("result", JSON.stringify({ ...result, sessionId: session?.id }));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", JSON.stringify({ error: message }));
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
