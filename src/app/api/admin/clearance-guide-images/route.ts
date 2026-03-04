import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clearanceGuideImages } from "@/lib/db/schema";
import {
  clearanceGuideImagePath,
  getSafeImageExtension,
  sha256,
  writeStorageFile,
} from "@/lib/storage";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler() {
  const rows = await db
    .select()
    .from(clearanceGuideImages)
    .orderBy(asc(clearanceGuideImages.createdAt));
  return NextResponse.json(rows);
}

async function POSTHandler(request: Request) {
  const formData = await request.formData();
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
  }

  const results: { id: string; filePath: string; duplicate?: boolean }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = sha256(buffer);
    const existing = await db.query.clearanceGuideImages.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.fileHash, hash),
    });
    if (existing) {
      results.push({ id: existing.id, filePath: existing.filePath, duplicate: true });
      continue;
    }

    const ext = getSafeImageExtension(file.name);
    const filename = `${hash.slice(0, 12)}_${Date.now()}.${ext}`;
    const relativePath = clearanceGuideImagePath(filename);
    const filePath = await writeStorageFile(relativePath, buffer);

    const [inserted] = await db
      .insert(clearanceGuideImages)
      .values({
        filePath,
        fileHash: hash,
        notes,
      })
      .returning({ id: clearanceGuideImages.id, filePath: clearanceGuideImages.filePath });
    results.push({ id: inserted.id, filePath: inserted.filePath });
  }

  return NextResponse.json(results);
}

async function DELETEHandler(request: Request) {
  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const [deleted] = await db
    .delete(clearanceGuideImages)
    .where(eq(clearanceGuideImages.id, id))
    .returning({ id: clearanceGuideImages.id });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/clearance-guide-images", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/clearance-guide-images", POSTHandler);

export const DELETE = withApiRouteErrorLogging("/api/admin/clearance-guide-images", DELETEHandler);
