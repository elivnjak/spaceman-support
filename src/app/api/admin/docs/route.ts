import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, docChunks } from "@/lib/db/schema";
import { writeStorageFile, documentPath } from "@/lib/storage";
import { extractTextPreview } from "@/lib/ingestion/document-ingestor";

export async function GET() {
  const list = await db
    .select()
    .from(documents)
    .orderBy(documents.createdAt);

  const counts = await db
    .select({
      documentId: docChunks.documentId,
      chunkCount: count(docChunks.id),
    })
    .from(docChunks)
    .groupBy(docChunks.documentId);

  const countMap = new Map(counts.map((c) => [c.documentId, c.chunkCount]));
  const listWithCounts = list.map((doc) => ({
    ...doc,
    chunkCount: countMap.get(doc.id) ?? 0,
  }));

  return NextResponse.json(listWithCounts);
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const title = formData.get("title") as string | null;
  const file = formData.get("file") as File | null;
  const pastedText = formData.get("pastedText") as string | null;
  const url = (formData.get("url") as string)?.trim() || null;
  const cssSelector = (formData.get("cssSelector") as string)?.trim() || null;
  const renderJs = Boolean(formData.get("renderJs"));
  const machineModel = (formData.get("machineModel") as string)?.trim() || null;
  const labelIdsRaw = (formData.get("labelIds") as string)?.trim() || "";
  let labelIds: string[] | null = null;
  if (labelIdsRaw) {
    try {
      const parsed = JSON.parse(labelIdsRaw);
      if (Array.isArray(parsed)) {
        labelIds = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      labelIds = labelIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  if (pastedText) {
    if (!title?.trim()) {
      return NextResponse.json(
        { error: "title required for pasted text" },
        { status: 400 }
      );
    }
    const [doc] = await db
      .insert(documents)
      .values({
        title,
        filePath: "_pasted",
        status: "UPLOADED",
        rawTextPreview: pastedText.slice(0, 1000),
        pastedContent: pastedText,
        machineModel,
        labelIds,
      })
      .returning();
    return NextResponse.json(doc);
  }

  if (url) {
    if (!title?.trim()) {
      return NextResponse.json(
        { error: "title required for URL" },
        { status: 400 }
      );
    }
    const [doc] = await db
      .insert(documents)
      .values({
        title,
        filePath: "_url",
        status: "UPLOADED",
        rawTextPreview: url.slice(0, 500),
        sourceUrl: url,
        cssSelector: cssSelector || null,
        renderJs,
        machineModel,
        labelIds,
      })
      .returning();
    return NextResponse.json(doc);
  }

  if (!file) {
    return NextResponse.json(
      { error: "file, pastedText, or url required" },
      { status: 400 }
    );
  }

  const fileTitle =
    title?.trim() ||
    file.name.replace(/\.[^.]+$/, "") ||
    file.name;

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "txt";
  const filename = `${Date.now()}_${file.name}`;
  const relativePath = documentPath(filename);
  const fullPath = await writeStorageFile(relativePath, buffer);

  const mimeType = file.type || (ext === "pdf" ? "application/pdf" : "text/plain");
  const { preview } = await extractTextPreview(buffer, mimeType);

  const [doc] = await db
    .insert(documents)
    .values({
      title: fileTitle,
      filePath: fullPath,
      status: "UPLOADED",
      rawTextPreview: preview,
      machineModel,
      labelIds,
    })
    .returning();

  return NextResponse.json(doc);
}
