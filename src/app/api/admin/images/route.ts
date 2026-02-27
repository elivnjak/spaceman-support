import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceImages } from "@/lib/db/schema";
import {
  writeStorageFile,
  sha256,
  referenceImagePath,
} from "@/lib/storage";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler() {
  const list = await db
    .select()
    .from(referenceImages)
    .orderBy(referenceImages.createdAt);
  return NextResponse.json(list);
}

async function POSTHandler(request: Request) {
  const formData = await request.formData();
  const labelId = formData.get("labelId") as string | null;
  const notes = (formData.get("notes") as string) || null;
  const files = formData.getAll("files") as File[];

  if (!labelId || !files.length) {
    return NextResponse.json(
      { error: "labelId and at least one file required" },
      { status: 400 }
    );
  }

  const results: { id: string; filePath: string; duplicate?: boolean }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = sha256(buffer);

    const existing = await db.query.referenceImages.findFirst({
      where: (r, { eq }) => eq(r.fileHash, hash),
    });
    if (existing) {
      results.push({
        id: existing.id,
        filePath: existing.filePath,
        duplicate: true,
      });
      continue;
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${hash.slice(0, 12)}_${Date.now()}.${ext}`;
    const relativePath = referenceImagePath(labelId, filename);
    const fullPath = await writeStorageFile(relativePath, buffer);

    const [inserted] = await db
      .insert(referenceImages)
      .values({
        labelId,
        filePath: fullPath,
        fileHash: hash,
        notes,
      })
      .returning({ id: referenceImages.id, filePath: referenceImages.filePath });

    results.push({
      id: inserted.id,
      filePath: inserted.filePath,
    });
  }

  return NextResponse.json(results);
}

export const GET = withApiRouteErrorLogging("/api/admin/images", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/images", POSTHandler);
