import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, docChunks } from "@/lib/db/schema";
import {
  ingestUrlContent,
  slugFromUrl,
} from "@/lib/ingestion/document-ingestor";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  let body: {
    url?: string;
    cssSelector?: string;
    renderJs?: boolean;
    machineModel?: string;
    labelIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const url = (body.url as string)?.trim();
  if (!url) {
    return NextResponse.json(
      { error: "url is required" },
      { status: 400 }
    );
  }

  const cssSelector = (body.cssSelector as string)?.trim() || null;
  const renderJs = Boolean(body.renderJs);
  const machineModel = (body.machineModel as string)?.trim() || null;
  const labelIds =
    Array.isArray(body.labelIds) && body.labelIds.length > 0
      ? body.labelIds
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0)
      : null;

  const placeholderTitle = slugFromUrl(url);

  const [doc] = await db
    .insert(documents)
    .values({
      title: placeholderTitle,
      filePath: "_url",
      status: "INGESTING",
      rawTextPreview: url.slice(0, 500),
      sourceUrl: url,
      cssSelector,
      renderJs,
      machineModel,
      labelIds,
    })
    .returning();

  if (!doc) {
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }

  try {
    await ingestUrlContent(doc.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(documents)
      .set({ status: "ERROR", errorMessage: message })
      .where(eq(documents.id, doc.id));
  }

  const updated = await db.query.documents.findFirst({
    where: eq(documents.id, doc.id),
  });
  if (!updated) {
    return NextResponse.json(
      { error: "Document not found after ingestion" },
      { status: 500 }
    );
  }

  const chunkCountResult = await db
    .select({ count: count(docChunks.id) })
    .from(docChunks)
    .where(eq(docChunks.documentId, doc.id));
  const chunkCount = chunkCountResult[0]?.count ?? 0;

  return NextResponse.json({
    ...updated,
    chunkCount,
  });
}
