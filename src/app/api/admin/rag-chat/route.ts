import { NextResponse } from "next/server";
import { requireAdminUiAuth } from "@/lib/auth";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import { runFollowUpAnswer, type ChatMessage } from "@/lib/pipeline/diagnostic-planner";
import { searchDocChunks } from "@/lib/pipeline/text-retrieval";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MAX_QUESTION_LENGTH = 4000;
const MAX_MODEL_LENGTH = 120;
const MAX_RECENT_MESSAGES = 12;

function getDefaultImageOnlyQuestion(modelNumber?: string): string {
  return modelNumber
    ? `Please analyze the attached image(s) for model ${modelNumber}.`
    : "Please analyze the attached image(s).";
}

type CitationPayload = {
  chunkId: string;
  content: string;
  documentId?: string;
};

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

function stripInvalidCitationMarkers(message: string, validChunkIds: Set<string>): string {
  if (validChunkIds.size === 0) {
    const re = new RegExp(
      `\\s*\\[(?:id:\\s*)?${UUID_PATTERN}\\]|\\s*\\((?:document\\s+)?${UUID_PATTERN}\\)`,
      "gi"
    );
    return message.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  const re = new RegExp(
    `(\\s*)(\\[(?:id:\\s*)?(${UUID_PATTERN})\\]|\\((?:document\\s+)?(${UUID_PATTERN})\\))`,
    "gi"
  );
  return message
    .replace(re, (_, space: string, marker: string, id1?: string, id2?: string) => {
      const id = (id1 ?? id2 ?? "").toLowerCase();
      return validChunkIds.has(id) ? space + marker : space;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildCitations(
  message: string,
  chunks: { id: string; content: string; documentId: string }[]
): CitationPayload[] {
  const ids = extractChunkIdsFromMessage(message);
  const byId = new Map(chunks.map((c) => [c.id.toLowerCase(), c]));
  const citations: CitationPayload[] = [];
  for (const id of ids) {
    const chunk = byId.get(id);
    if (chunk) {
      citations.push({
        chunkId: chunk.id,
        content: chunk.content,
        documentId: chunk.documentId,
      });
    }
  }
  return citations;
}

function normalizeRecentMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const sanitized: ChatMessage[] = [];
  for (const item of value.slice(-MAX_RECENT_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const roleRaw = (item as { role?: unknown }).role;
    const contentRaw = (item as { content?: unknown }).content;
    if ((roleRaw !== "user" && roleRaw !== "assistant") || typeof contentRaw !== "string") continue;
    const content = contentRaw.trim();
    if (!content) continue;
    sanitized.push({
      role: roleRaw,
      content: content.slice(0, MAX_QUESTION_LENGTH),
    });
  }
  return sanitized;
}

async function POSTHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const contentType = request.headers.get("content-type") ?? "";
  let bodyModelNumber: unknown = null;
  let bodyQuestion: unknown = null;
  let bodyMessages: unknown = null;
  const imageBuffers: Buffer[] = [];

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const formData = await request.formData();
    bodyModelNumber = formData.get("modelNumber");
    bodyQuestion = formData.get("question");
    const rawMessages = formData.get("messages");
    if (typeof rawMessages === "string") {
      try {
        bodyMessages = JSON.parse(rawMessages);
      } catch {
        bodyMessages = null;
      }
    }
    const imageFiles = formData.getAll("images");
    for (const image of imageFiles) {
      if (!(image instanceof File) || image.size <= 0) continue;
      imageBuffers.push(Buffer.from(await image.arrayBuffer()));
    }
  } else {
    const body = (await request.json().catch(() => null)) as
      | {
          modelNumber?: unknown;
          question?: unknown;
          messages?: unknown;
        }
      | null;
    bodyModelNumber = body?.modelNumber;
    bodyQuestion = body?.question;
    bodyMessages = body?.messages;
  }

  const modelNumber =
    typeof bodyModelNumber === "string" ? bodyModelNumber.trim().slice(0, MAX_MODEL_LENGTH) : "";
  let question =
    typeof bodyQuestion === "string" ? bodyQuestion.trim().slice(0, MAX_QUESTION_LENGTH) : "";

  if (!question && imageBuffers.length === 0) {
    return NextResponse.json({ error: "Question or image is required." }, { status: 400 });
  }

  if (!question) {
    question = getDefaultImageOnlyQuestion(modelNumber || undefined);
  }

  const recentMessages = normalizeRecentMessages(bodyMessages);
  const queryEmbedding = await openaiTextEmbedder.embed(question);
  const chunks = await searchDocChunks(
    queryEmbedding,
    undefined,
    modelNumber || undefined,
    undefined,
    question
  );
  const chunkPayload = chunks.map((c) => ({
    id: c.id,
    content: c.content,
    metadata: c.metadata,
    documentId: c.documentId,
  }));

  const rawAnswer = await runFollowUpAnswer({
    recentMessages,
    docChunks: chunkPayload,
    lastUserMessage: question,
    resolution: undefined,
    machineModel: modelNumber || undefined,
    imageBuffers: imageBuffers.length > 0 ? imageBuffers : undefined,
  });

  const validChunkIds = new Set(chunkPayload.map((c) => c.id.toLowerCase()));
  const answer = stripInvalidCitationMarkers(rawAnswer, validChunkIds);
  const citations = buildCitations(answer, chunkPayload);

  return NextResponse.json({
    answer,
    citations,
    retrievedChunkCount: chunkPayload.length,
  });
}

export const POST = withApiRouteErrorLogging("/api/admin/rag-chat", POSTHandler);
