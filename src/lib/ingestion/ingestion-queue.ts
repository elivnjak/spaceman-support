import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  ingestDocument,
  ingestPastedText,
  ingestUrl,
} from "@/lib/ingestion/document-ingestor";

let queueWorker: Promise<void> | null = null;

function startQueueWorker(): void {
  if (queueWorker) return;
  queueWorker = runQueueWorker().finally(() => {
    queueWorker = null;
  });
}

async function runQueueWorker(): Promise<void> {
  while (true) {
    const next = await db.query.documents.findFirst({
      where: eq(documents.status, "PENDING"),
      orderBy: [asc(documents.queuedAt), asc(documents.createdAt)],
    });

    if (!next) return;

    try {
      if (next.filePath === "_pasted" || next.pastedContent) {
        await ingestPastedText(next.id);
      } else if (next.filePath === "_url" && next.sourceUrl) {
        await ingestUrl(next.id);
      } else {
        await ingestDocument(next.id);
      }
    } catch {
      // Ingestor functions persist ERROR status; continue to next queued document.
    }
  }
}

export async function enqueueDocumentIngestion(
  documentId: string,
  options?: { pastedText?: string }
): Promise<{ status: "queued" | "already_running" | "not_found" }> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });

  if (!doc) return { status: "not_found" };
  if (doc.status === "INGESTING" || doc.status === "PENDING") {
    startQueueWorker();
    return { status: "already_running" };
  }

  const updates: Partial<typeof documents.$inferInsert> = {
    status: "PENDING",
    errorMessage: null,
    queuedAt: new Date(),
    ingestionProgress: 0,
    ingestionStage: "Queued",
    ingestionStartedAt: null,
    ingestionCompletedAt: null,
  };

  if (typeof options?.pastedText === "string" && doc.filePath === "_pasted") {
    updates.pastedContent = options.pastedText;
    updates.rawTextPreview = options.pastedText.slice(0, 1000);
  }

  await db.update(documents).set(updates).where(eq(documents.id, documentId));
  startQueueWorker();
  return { status: "queued" };
}

export function kickIngestionWorker(): void {
  startQueueWorker();
}
