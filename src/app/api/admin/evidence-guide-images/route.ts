import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { evidenceGuideImages, playbooks } from "@/lib/db/schema";
import {
  evidenceGuideImagePath,
  getSafeImageExtension,
  sha256,
  writeStorageFile,
} from "@/lib/storage";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type PlaybookEvidenceLike = {
  guideImageIds?: string[];
};

function removeGuideImageIdFromChecklist(
  evidenceChecklist: unknown,
  imageId: string
): { nextValue: unknown; changed: boolean } {
  if (!Array.isArray(evidenceChecklist)) {
    return { nextValue: evidenceChecklist, changed: false };
  }

  let changed = false;
  const nextValue = evidenceChecklist.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const typedItem = item as PlaybookEvidenceLike & Record<string, unknown>;
    if (!Array.isArray(typedItem.guideImageIds)) {
      return item;
    }
    const nextGuideImageIds = typedItem.guideImageIds.filter((value) => value !== imageId);
    if (nextGuideImageIds.length === typedItem.guideImageIds.length) {
      return item;
    }
    changed = true;
    return {
      ...typedItem,
      ...(nextGuideImageIds.length > 0 ? { guideImageIds: nextGuideImageIds } : {}),
    };
  });

  return { nextValue, changed };
}

async function GETHandler() {
  const rows = await db
    .select()
    .from(evidenceGuideImages)
    .orderBy(asc(evidenceGuideImages.createdAt));

  return NextResponse.json(
    rows.map((row) => ({
      ...row,
      url: `/api/evidence-guide-image/${row.id}`,
    }))
  );
}

async function POSTHandler(request: Request) {
  const formData = await request.formData();
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
  }

  const results: { id: string; filePath: string; notes: string | null; url: string; duplicate?: boolean }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = sha256(buffer);
    const existing = await db.query.evidenceGuideImages.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.fileHash, hash),
    });
    if (existing) {
      results.push({
        id: existing.id,
        filePath: existing.filePath,
        notes: existing.notes,
        url: `/api/evidence-guide-image/${existing.id}`,
        duplicate: true,
      });
      continue;
    }

    const ext = getSafeImageExtension(file.name);
    const filename = `${hash.slice(0, 12)}_${Date.now()}.${ext}`;
    const relativePath = evidenceGuideImagePath(filename);
    const filePath = await writeStorageFile(relativePath, buffer);

    const [inserted] = await db
      .insert(evidenceGuideImages)
      .values({
        filePath,
        fileHash: hash,
        notes,
      })
      .returning({
        id: evidenceGuideImages.id,
        filePath: evidenceGuideImages.filePath,
        notes: evidenceGuideImages.notes,
      });

    results.push({
      id: inserted.id,
      filePath: inserted.filePath,
      notes: inserted.notes,
      url: `/api/evidence-guide-image/${inserted.id}`,
    });
  }

  return NextResponse.json(results);
}

async function DELETEHandler(request: Request) {
  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const deleted = await db.transaction(async (tx) => {
    const [removedImage] = await tx
      .delete(evidenceGuideImages)
      .where(eq(evidenceGuideImages.id, id))
      .returning({ id: evidenceGuideImages.id });

    if (!removedImage) {
      return null;
    }

    const playbookRows = await tx
      .select({
        id: playbooks.id,
        evidenceChecklist: playbooks.evidenceChecklist,
      })
      .from(playbooks);

    for (const playbookRow of playbookRows) {
      const { nextValue, changed } = removeGuideImageIdFromChecklist(
        playbookRow.evidenceChecklist,
        id
      );
      if (!changed) continue;
      await tx
        .update(playbooks)
        .set({
          evidenceChecklist: nextValue,
          updatedAt: new Date(),
        })
        .where(eq(playbooks.id, playbookRow.id));
    }

    return removedImage;
  });

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/evidence-guide-images", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/evidence-guide-images", POSTHandler);

export const DELETE = withApiRouteErrorLogging("/api/admin/evidence-guide-images", DELETEHandler);
