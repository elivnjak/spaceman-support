import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteStorageFile, getStorageRelativePath } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json(doc);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const title = body.title as string | undefined;
  const pastedContent = body.pastedContent as string | undefined;
  const machineModel = body.machineModel as string | undefined;
  const cssSelector = body.cssSelector as string | undefined;
  const labelIds = body.labelIds as unknown;

  const updates: Partial<{
    title: string;
    pastedContent: string;
    rawTextPreview: string;
    machineModel: string | null;
    cssSelector: string | null;
    labelIds: string[] | null;
  }> = {};

  if (title !== undefined) {
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json(
        { error: "title must be a non-empty string" },
        { status: 400 }
      );
    }
    updates.title = title.trim();
  }

  if (pastedContent !== undefined) {
    if (doc.filePath !== "_pasted") {
      return NextResponse.json(
        { error: "pastedContent can only be updated for pasted-text documents" },
        { status: 400 }
      );
    }
    updates.pastedContent = pastedContent;
    updates.rawTextPreview = (pastedContent ?? "").slice(0, 1000);
  }

  if (machineModel !== undefined) {
    updates.machineModel =
      machineModel === null || (typeof machineModel === "string" && !machineModel.trim())
        ? null
        : String(machineModel).trim();
  }

  if (cssSelector !== undefined) {
    updates.cssSelector =
      cssSelector === null || (typeof cssSelector === "string" && !cssSelector.trim())
        ? null
        : String(cssSelector).trim();
  }

  if (labelIds !== undefined) {
    if (labelIds === null) {
      updates.labelIds = null;
    } else if (Array.isArray(labelIds)) {
      updates.labelIds = labelIds
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0);
    } else {
      return NextResponse.json(
        { error: "labelIds must be an array of strings or null" },
        { status: 400 }
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(doc);
  }

  const [updated] = await db
    .update(documents)
    .set(updates)
    .where(eq(documents.id, id))
    .returning();
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // URL and pasted documents have no file on disk; only delete storage for uploaded files
  if (doc.filePath !== "_pasted" && doc.filePath !== "_url") {
    try {
      const relativePath = getStorageRelativePath(doc.filePath);
      await deleteStorageFile(relativePath);
    } catch (err) {
      // Log but continue; DB row and chunks should still be removed
      console.error("Failed to delete storage file:", doc.filePath, err);
    }
  }

  await db.delete(documents).where(eq(documents.id, id));
  return new NextResponse(null, { status: 204 });
}
