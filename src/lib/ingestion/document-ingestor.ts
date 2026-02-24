import { INGESTION_CONFIG } from "@/lib/config";
import { db } from "@/lib/db";
import { documents, docChunks, machineSpecs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractSpecsFromMarkdown } from "./extract-specs";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import { chunkBySize, chunkMarkdownOrText, flattenTablesToKV } from "./chunker";
import { extractPagesWithVision } from "./pdf-vision-extractor";
import {
  extractPdfPages,
  getFullTextFromPages,
  getTableHeavyPageNumbers,
  type PageText,
} from "./pdf-text-extractor";
import { verifyNumerics } from "./verify-numerics";
import { extractHtmlToMarkdown } from "./html-extractor";
import {
  extractMachineModelFromText,
  formatMachineModelsForStorage,
} from "./extract-machine-model";

const PREVIEW_LENGTH = 1000;

/** Split vision markdown by <!-- page N --> into a map pageNum -> content. */
function splitVisionMarkdownByPage(markdown: string): Map<number, string> {
  const map = new Map<number, string>();
  const re = /\s*<!--\s*page\s+(\d+)\s*-->\s*/gi;
  let lastIndex = 0;
  let lastPage: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const pageNum = parseInt(match[1]!, 10);
    if (lastPage != null) {
      const content = markdown.slice(lastIndex, match.index).trim();
      if (content) map.set(lastPage, content);
    }
    lastPage = pageNum;
    lastIndex = match.index + match[0].length;
  }
  if (lastPage != null) {
    const content = markdown.slice(lastIndex).trim();
    if (content) map.set(lastPage, content);
  }
  if (map.size === 0 && markdown.trim()) map.set(1, markdown.trim());
  return map;
}

/** Build merged markdown: narrative pages use deterministic text; table-heavy pages use vision content. */
function buildMergedMarkdown(
  pages: PageText[],
  tableHeavySet: Set<number>,
  visionByPage: Map<number, string>
): string {
  const parts: string[] = [];
  for (const p of pages) {
    if (tableHeavySet.has(p.pageNum)) {
      const visionContent = visionByPage.get(p.pageNum);
      if (visionContent) {
        parts.push(`<!-- page ${p.pageNum} -->\n\n${visionContent}`);
      } else {
        parts.push(`<!-- page ${p.pageNum} -->\n\n${p.text}`);
      }
    } else {
      parts.push(`<!-- page ${p.pageNum} -->\n\n${p.text}`);
    }
  }
  return parts.join("\n\n");
}

async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<{ text: string; metadata?: Record<string, unknown> }> {
  if (mimeType.includes("pdf")) {
    const pages = await extractPdfPages(buffer);
    const text = getFullTextFromPages(pages);
    return { text, metadata: { pages: pages.length } };
  }
  const str = buffer.toString("utf-8");
  return { text: str, metadata: {} };
}

export async function extractTextPreview(
  buffer: Buffer,
  mimeType: string
): Promise<{ preview: string; fullText: string; metadata?: Record<string, unknown> }> {
  const { text, metadata } = await extractTextFromBuffer(buffer, mimeType);
  return {
    preview: text.slice(0, PREVIEW_LENGTH),
    fullText: text,
    metadata,
  };
}

export async function ingestDocument(documentId: string): Promise<void> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) throw new Error("Document not found");
  if (doc.status === "INGESTING") throw new Error("Document is already ingesting");

  await db
    .update(documents)
    .set({ status: "INGESTING", errorMessage: null })
    .where(eq(documents.id, documentId));

  try {
    const { readStorageFile, getStorageRelativePath } = await import("@/lib/storage");
    const relativePath = getStorageRelativePath(doc.filePath);
    const buffer = await readStorageFile(relativePath);

    const isPdf = doc.filePath.toLowerCase().endsWith(".pdf");
    const mimeType = isPdf ? "application/pdf" : "text/plain";

    if (!isPdf) {
      const { fullText } = await extractTextPreview(buffer, mimeType);
      const chunks = chunkMarkdownOrText(
        fullText,
        doc.filePath.toLowerCase().endsWith(".md") ? "md" : "txt"
      );
      const textsToEmbed = chunks.map((c) =>
        (c.metadata?.kv_content as string) ?? c.content
      );
      const embeddings = await openaiTextEmbedder.embedBatch(textsToEmbed);
      await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
      for (let i = 0; i < chunks.length; i++) {
        await db.insert(docChunks).values({
          documentId,
          chunkIndex: i,
          content: chunks[i].content,
          metadata: chunks[i].metadata,
          embedding: embeddings[i] ?? null,
        });
      }
      const autoModels = formatMachineModelsForStorage(
        extractMachineModelFromText(fullText)
      );
      const hasExistingModel =
        doc.machineModel != null && String(doc.machineModel).trim() !== "";
      await db
        .update(documents)
        .set({
          status: "READY",
          errorMessage: null,
          machineModel: hasExistingModel ? doc.machineModel : (autoModels ?? null),
        })
        .where(eq(documents.id, documentId));
      return;
    }

    const pages = await extractPdfPages(buffer);
    const fullText = getFullTextFromPages(pages);
    const numPages = pages.length;

    if (numPages > INGESTION_CONFIG.maxPagesForVision) {
      const chunks = chunkBySize(fullText).map((c) => ({
        content: c.content,
        metadata: {} as Record<string, unknown>,
      }));
      const embeddings = await openaiTextEmbedder.embedBatch(chunks.map((c) => c.content));
      await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
      for (let i = 0; i < chunks.length; i++) {
        await db.insert(docChunks).values({
          documentId,
          chunkIndex: i,
          content: chunks[i].content,
          metadata: chunks[i].metadata,
          embedding: embeddings[i] ?? null,
        });
      }
      const autoModels = formatMachineModelsForStorage(
        extractMachineModelFromText(fullText)
      );
      const hasExistingModel =
        doc.machineModel != null && String(doc.machineModel).trim() !== "";
      await db
        .update(documents)
        .set({
          status: "READY",
          errorMessage: null,
          machineModel: hasExistingModel ? doc.machineModel : (autoModels ?? null),
        })
        .where(eq(documents.id, documentId));
      return;
    }

    const tableHeavyPages = getTableHeavyPageNumbers(pages);
    const tableHeavySet = new Set(tableHeavyPages);
    let mergedMarkdown: string;
    let verificationStatus: "verified" | "unverified" | "mismatch" = "unverified";
    let source: "deterministic" | "vision" = "deterministic";

    if (tableHeavyPages.length > 0) {
      try {
        const visionResult = await extractPagesWithVision(buffer, tableHeavyPages);
        if (visionResult.markdown) {
          if (INGESTION_CONFIG.verifyNumerics) {
            const verification = verifyNumerics(
              visionResult.markdown,
              pages,
              visionResult.pagesProcessed
            );
            verificationStatus = verification.status;
          }
          const visionByPage = splitVisionMarkdownByPage(visionResult.markdown);
          mergedMarkdown = buildMergedMarkdown(pages, tableHeavySet, visionByPage);
          source = "vision";
        } else {
          mergedMarkdown = fullText;
        }
      } catch {
        mergedMarkdown = fullText;
      }
    } else {
      mergedMarkdown = fullText;
    }

    const rawChunks = mergedMarkdown.includes("##")
      ? chunkMarkdownOrText(mergedMarkdown, "md")
      : chunkBySize(mergedMarkdown).map((c) => ({ content: c.content, metadata: {} as Record<string, unknown> }));

    const chunks = rawChunks.map((c) => {
      const meta = { ...c.metadata, source, verification_status: verificationStatus } as Record<string, unknown>;
      const kv = flattenTablesToKV(c.content);
      if (kv) meta.kv_content = kv;
      return { content: c.content, metadata: meta };
    });

    const textsToEmbed = chunks.map((c) =>
      (c.metadata.kv_content as string) ?? c.content
    );
    const embeddings = await openaiTextEmbedder.embedBatch(textsToEmbed);

    await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(docChunks).values({
        documentId,
        chunkIndex: i,
        content: chunks[i].content,
        metadata: chunks[i].metadata,
        embedding: embeddings[i] ?? null,
      });
    }

    const resolvedMachineModels = extractMachineModelFromText(mergedMarkdown);
    const resolvedMachineModelStr =
      formatMachineModelsForStorage(resolvedMachineModels) ?? null;
    const hasExistingModel =
      doc.machineModel != null && String(doc.machineModel).trim() !== "";

    if (resolvedMachineModels.length > 0 && source === "vision" && mergedMarkdown) {
      try {
        const specs = extractSpecsFromMarkdown(mergedMarkdown);
        for (const model of resolvedMachineModels) {
          await db
            .insert(machineSpecs)
            .values({
              machineModel: model,
              documentId,
              specs,
              rawSource: "vision",
              verified: verificationStatus === "verified",
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: machineSpecs.machineModel,
              set: {
                documentId,
                specs,
                rawSource: "vision",
                verified: verificationStatus === "verified",
                updatedAt: new Date(),
              },
            });
        }
      } catch {
        // non-fatal: ingestion still succeeded
      }
    }

    await db
      .update(documents)
      .set({
        status: "READY",
        errorMessage: null,
        machineModel: hasExistingModel
          ? doc.machineModel
          : (resolvedMachineModelStr ?? null),
      })
      .where(eq(documents.id, documentId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({ status: "ERROR", errorMessage: message })
      .where(eq(documents.id, documentId));
    throw err;
  }
}

/** Derive a short title from URL path (e.g. last path segment or hostname). */
export function slugFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const path = u.pathname.replace(/\/+$/, "");
    const segment = path.split("/").filter(Boolean).pop();
    if (segment) return decodeURIComponent(segment);
    return u.hostname || "untitled";
  } catch {
    return "untitled";
  }
}

/**
 * Core URL ingestion: fetch HTML, extract markdown, chunk, embed, store.
 * Updates document title from extracted HTML title (fallback: URL slug) and machine model from content if not set.
 * Caller must have already set document status to INGESTING.
 */
export async function ingestUrlContent(documentId: string): Promise<void> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) throw new Error("Document not found");
  const sourceUrl = doc.sourceUrl ?? "";
  if (!sourceUrl) throw new Error("No source URL to ingest");

  const { title: extractedTitle, markdown } = await extractHtmlToMarkdown(
    sourceUrl,
    doc.cssSelector ?? undefined,
    doc.renderJs ?? false
  );
  const resolvedTitle =
    (extractedTitle?.trim() && extractedTitle) || slugFromUrl(sourceUrl);

  const chunks = chunkMarkdownOrText(markdown, "md");
  const withMeta = chunks.map((c) => ({
    ...c,
    metadata: {
      ...c.metadata,
      source: "html",
      source_url: sourceUrl,
    } as Record<string, unknown>,
  }));
  const textsToEmbed = withMeta.map((c) =>
    (c.metadata?.kv_content as string) ?? c.content
  );
  const embeddings = await openaiTextEmbedder.embedBatch(textsToEmbed);

  await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
  for (let i = 0; i < withMeta.length; i++) {
    await db.insert(docChunks).values({
      documentId,
      chunkIndex: i,
      content: withMeta[i].content,
      metadata: withMeta[i].metadata,
      embedding: embeddings[i] ?? null,
    });
  }

  const autoModels = formatMachineModelsForStorage(
    extractMachineModelFromText(markdown)
  );
  const hasExistingModel =
    doc.machineModel != null && String(doc.machineModel).trim() !== "";
  await db
    .update(documents)
    .set({
      status: "READY",
      errorMessage: null,
      title: resolvedTitle,
      machineModel: hasExistingModel ? doc.machineModel : (autoModels ?? null),
    })
    .where(eq(documents.id, documentId));
}

export async function ingestUrl(documentId: string): Promise<void> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) throw new Error("Document not found");
  if (doc.status === "INGESTING") throw new Error("Document is already ingesting");
  const sourceUrl = doc.sourceUrl ?? "";
  if (!sourceUrl) throw new Error("No source URL to ingest");

  await db
    .update(documents)
    .set({ status: "INGESTING", errorMessage: null })
    .where(eq(documents.id, documentId));

  try {
    await ingestUrlContent(documentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({ status: "ERROR", errorMessage: message })
      .where(eq(documents.id, documentId));
    throw err;
  }
}

export async function ingestPastedText(
  documentId: string,
  pastedText?: string
): Promise<void> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) throw new Error("Document not found");
  const text = pastedText ?? doc.pastedContent ?? "";
  if (!text) throw new Error("No pasted content to ingest");

  await db
    .update(documents)
    .set({ status: "INGESTING", errorMessage: null })
    .where(eq(documents.id, documentId));

  try {
    const chunks = chunkMarkdownOrText(text, "txt");
    const embeddings = await openaiTextEmbedder.embedBatch(
      chunks.map((c) => c.content)
    );

    await db.delete(docChunks).where(eq(docChunks.documentId, documentId));

    for (let i = 0; i < chunks.length; i++) {
      await db.insert(docChunks).values({
        documentId,
        chunkIndex: i,
        content: chunks[i].content,
        metadata: chunks[i].metadata,
        embedding: embeddings[i] ?? null,
      });
    }

    const autoModels = formatMachineModelsForStorage(
      extractMachineModelFromText(text)
    );
    const hasExistingModel =
      doc.machineModel != null && String(doc.machineModel).trim() !== "";
    await db
      .update(documents)
      .set({
        status: "READY",
        errorMessage: null,
        machineModel: hasExistingModel ? doc.machineModel : (autoModels ?? null),
      })
      .where(eq(documents.id, documentId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({ status: "ERROR", errorMessage: message })
      .where(eq(documents.id, documentId));
    throw err;
  }
}
