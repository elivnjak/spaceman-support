import { INGESTION_CONFIG } from "@/lib/config";
import { db } from "@/lib/db";
import { documents, docChunks, machineSpecs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { extractSpecsFromMarkdown } from "./extract-specs";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import { chunkBySize, chunkMarkdownOrText, flattenTablesToKV } from "./chunker";
import { extractPagesWithVision } from "./pdf-vision-extractor";
import { chunkDocumentWithLlm } from "./llm-chunker";
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

async function updateIngestionProgress(
  documentId: string,
  progress: number,
  stage: string
): Promise<void> {
  await db
    .update(documents)
    .set({
      ingestionProgress: Math.max(0, Math.min(100, Math.round(progress))),
      ingestionStage: stage,
    })
    .where(eq(documents.id, documentId));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

/**
 * Build embedding text that incorporates chunk metadata (title/tags) plus content.
 * This improves retrieval when user queries match labels/tags more than body text wording.
 */
function buildChunkEmbeddingText(chunk: {
  content: string;
  metadata?: Record<string, unknown>;
}): string {
  const metadata = chunk.metadata ?? {};
  const title = typeof metadata.title === "string" ? metadata.title.trim() : "";
  const tags = toStringArray(metadata.tags);
  const kvContent =
    typeof metadata.kv_content === "string" ? metadata.kv_content.trim() : "";
  const baseContent = kvContent || chunk.content;

  const parts: string[] = [];
  if (title) parts.push(`Title: ${title}`);
  if (tags.length > 0) parts.push(`Tags: ${tags.join(", ")}`);
  parts.push(baseContent);
  return parts.join("\n");
}

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

  await db
    .update(documents)
    .set({
      status: "INGESTING",
      errorMessage: null,
      ingestionProgress: 5,
      ingestionStage: "Preparing document",
      ingestionStartedAt: new Date(),
      ingestionCompletedAt: null,
    })
    .where(eq(documents.id, documentId));

  try {
    const { readStorageFile, getStorageRelativePath } = await import("@/lib/storage");
    const relativePath = getStorageRelativePath(doc.filePath);
    const buffer = await readStorageFile(relativePath);

    const isPdf = doc.filePath.toLowerCase().endsWith(".pdf");
    const mimeType = isPdf ? "application/pdf" : "text/plain";

    if (!isPdf) {
      await updateIngestionProgress(documentId, 20, "Chunking text");
      const { fullText } = await extractTextPreview(buffer, mimeType);
      const chunks = chunkMarkdownOrText(
        fullText,
        doc.filePath.toLowerCase().endsWith(".md") ? "md" : "txt"
      );
      await updateIngestionProgress(documentId, 55, "Generating embeddings");
      const textsToEmbed = chunks.map(buildChunkEmbeddingText);
      const embeddings = await openaiTextEmbedder.embedBatch(textsToEmbed);
      await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
      await updateIngestionProgress(documentId, 80, "Saving chunks");
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
        extractMachineModelFromText(`${doc.title}\n${fullText}`)
      );
      const hasExistingModel =
        doc.machineModel != null && String(doc.machineModel).trim() !== "";
      await db
        .update(documents)
        .set({
          status: "READY",
          errorMessage: null,
          ingestionProgress: 100,
          ingestionStage: "Complete",
          ingestionCompletedAt: new Date(),
          machineModel: hasExistingModel ? doc.machineModel : (autoModels ?? null),
        })
        .where(eq(documents.id, documentId));
      return;
    }

    const pages = await extractPdfPages(buffer);
    const fullText = getFullTextFromPages(pages);
    const numPages = pages.length;
    const fileName = doc.filePath.split(/[/\\]/).pop() ?? "document.pdf";
    await updateIngestionProgress(documentId, 20, `Parsed ${numPages} PDF pages`);

    // --- LLM Chunker path: primary for PDFs within the page limit ---
    const llmChunkerMaxPages = INGESTION_CONFIG.maxPagesForLlmChunker;
    if (llmChunkerMaxPages > 0 && numPages <= llmChunkerMaxPages) {
      let llmSuccess = false;
      try {
        const llmResult = await chunkDocumentWithLlm(buffer, fileName, numPages);
        await updateIngestionProgress(documentId, 45, "LLM chunking complete");

        let verificationStatus: "verified" | "unverified" | "mismatch" = "unverified";
        if (INGESTION_CONFIG.verifyNumerics) {
          const verification = verifyNumerics(
            llmResult.rawMarkdown,
            pages,
            pages.map((p) => p.pageNum)
          );
          verificationStatus = verification.status;
        }

        const chunks = llmResult.chunks.map((c) => ({
          content: c.content,
          metadata: {
            ...c.metadata,
            verification_status: verificationStatus,
          } as Record<string, unknown>,
        }));

        const embeddings = await openaiTextEmbedder.embedBatch(
          chunks.map(buildChunkEmbeddingText)
        );
        await updateIngestionProgress(documentId, 70, "Saving LLM chunks");

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

        const resolvedMachineModels = extractMachineModelFromText(
          `${doc.title}\n${llmResult.rawMarkdown}\n${fullText}`
        );
        const resolvedMachineModelStr =
          formatMachineModelsForStorage(resolvedMachineModels) ?? null;
        const hasExistingModel =
          doc.machineModel != null && String(doc.machineModel).trim() !== "";

        if (resolvedMachineModels.length > 0 && llmResult.rawMarkdown) {
          try {
            const specs = extractSpecsFromMarkdown(llmResult.rawMarkdown);
            for (const model of resolvedMachineModels) {
              await db
                .insert(machineSpecs)
                .values({
                  machineModel: model,
                  documentId,
                  specs,
                  rawSource: "llm_chunker",
                  verified: verificationStatus === "verified",
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: machineSpecs.machineModel,
                  set: {
                    documentId,
                    specs,
                    rawSource: "llm_chunker",
                    verified: verificationStatus === "verified",
                    updatedAt: new Date(),
                  },
                });
            }
          } catch {
            // non-fatal
          }
        }

        await db
          .update(documents)
          .set({
            status: "READY",
            errorMessage: null,
            ingestionProgress: 100,
            ingestionStage: "Complete",
            ingestionCompletedAt: new Date(),
            machineModel: hasExistingModel
              ? doc.machineModel
              : (resolvedMachineModelStr ?? null),
          })
          .where(eq(documents.id, documentId));

        llmSuccess = true;
      } catch (llmErr) {
        if (process.env.NODE_ENV !== "test") {
          console.warn(
            `[ingest] LLM chunker failed for doc ${documentId}, falling back to deterministic path:`,
            llmErr instanceof Error ? llmErr.message : llmErr
          );
        }
      }

      if (llmSuccess) return;
    }

    // --- Fallback: deterministic + vision path (large PDFs or LLM failure) ---

    if (numPages > INGESTION_CONFIG.maxPagesForVision) {
      await updateIngestionProgress(documentId, 40, "Chunking large PDF");
      const chunks = chunkBySize(fullText).map((c) => ({
        content: c.content,
        metadata: {} as Record<string, unknown>,
      }));
      const embeddings = await openaiTextEmbedder.embedBatch(
        chunks.map(buildChunkEmbeddingText)
      );
      await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
      await updateIngestionProgress(documentId, 75, "Saving chunks");
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
        extractMachineModelFromText(`${doc.title}\n${fullText}`)
      );
      const hasExistingModel =
        doc.machineModel != null && String(doc.machineModel).trim() !== "";
      await db
        .update(documents)
        .set({
          status: "READY",
          errorMessage: null,
          ingestionProgress: 100,
          ingestionStage: "Complete",
          ingestionCompletedAt: new Date(),
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

    const textsToEmbed = chunks.map(buildChunkEmbeddingText);
    await updateIngestionProgress(documentId, 65, "Generating embeddings");
    const embeddings = await openaiTextEmbedder.embedBatch(textsToEmbed);

    await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
    await updateIngestionProgress(documentId, 82, "Saving chunks");
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(docChunks).values({
        documentId,
        chunkIndex: i,
        content: chunks[i].content,
        metadata: chunks[i].metadata,
        embedding: embeddings[i] ?? null,
      });
    }

    const resolvedMachineModels = extractMachineModelFromText(
      `${doc.title}\n${mergedMarkdown}`
    );
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
        // non-fatal
      }
    }

    await db
      .update(documents)
      .set({
        status: "READY",
        errorMessage: null,
        ingestionProgress: 100,
        ingestionStage: "Complete",
        ingestionCompletedAt: new Date(),
        machineModel: hasExistingModel
          ? doc.machineModel
          : (resolvedMachineModelStr ?? null),
      })
      .where(eq(documents.id, documentId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({
        status: "ERROR",
        errorMessage: message,
        ingestionStage: "Failed",
        ingestionCompletedAt: new Date(),
      })
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
  const textsToEmbed = withMeta.map(buildChunkEmbeddingText);
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
    extractMachineModelFromText(`${resolvedTitle}\n${sourceUrl}\n${markdown}`)
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
  const sourceUrl = doc.sourceUrl ?? "";
  if (!sourceUrl) throw new Error("No source URL to ingest");

  await db
    .update(documents)
    .set({
      status: "INGESTING",
      errorMessage: null,
      ingestionProgress: 5,
      ingestionStage: "Fetching URL",
      ingestionStartedAt: new Date(),
      ingestionCompletedAt: null,
    })
    .where(eq(documents.id, documentId));

  try {
    await updateIngestionProgress(documentId, 35, "Extracting page content");
    await ingestUrlContent(documentId);
    await db
      .update(documents)
      .set({
        ingestionProgress: 100,
        ingestionStage: "Complete",
        ingestionCompletedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({
        status: "ERROR",
        errorMessage: message,
        ingestionStage: "Failed",
        ingestionCompletedAt: new Date(),
      })
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
    .set({
      status: "INGESTING",
      errorMessage: null,
      ingestionProgress: 10,
      ingestionStage: "Chunking pasted text",
      ingestionStartedAt: new Date(),
      ingestionCompletedAt: null,
    })
    .where(eq(documents.id, documentId));

  try {
    const chunks = chunkMarkdownOrText(text, "txt");
    await updateIngestionProgress(documentId, 55, "Generating embeddings");
    const embeddings = await openaiTextEmbedder.embedBatch(
      chunks.map(buildChunkEmbeddingText)
    );

    await db.delete(docChunks).where(eq(docChunks.documentId, documentId));
    await updateIngestionProgress(documentId, 80, "Saving chunks");

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
      extractMachineModelFromText(`${doc.title}\n${text}`)
    );
    const hasExistingModel =
      doc.machineModel != null && String(doc.machineModel).trim() !== "";
    await db
      .update(documents)
      .set({
        status: "READY",
        errorMessage: null,
        ingestionProgress: 100,
        ingestionStage: "Complete",
        ingestionCompletedAt: new Date(),
        machineModel: hasExistingModel ? doc.machineModel : (autoModels ?? null),
      })
      .where(eq(documents.id, documentId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({
        status: "ERROR",
        errorMessage: message,
        ingestionStage: "Failed",
        ingestionCompletedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    throw err;
  }
}
