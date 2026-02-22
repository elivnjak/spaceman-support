import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceImages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  writeStorageFile,
  sha256,
  referenceImagePath,
} from "@/lib/storage";
import {
  embedWithProvider,
  getConfiguredClipProvider,
} from "@/lib/embeddings/clip";

export async function GET() {
  const list = await db
    .select()
    .from(referenceImages)
    .orderBy(referenceImages.createdAt);
  return NextResponse.json(list);
}

export async function POST(request: Request) {
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
  const provider = getConfiguredClipProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "No CLIP provider configured for image embeddings." },
      { status: 400 }
    );
  }

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
        embedding: null,
      })
      .returning({ id: referenceImages.id, filePath: referenceImages.filePath });

    try {
      const { embedding } = await embedWithProvider(buffer);
      await db
        .update(referenceImages)
        .set({ embedding })
        .where(eq(referenceImages.id, inserted.id));
    } catch (err) {
      console.error("CLIP embed failed for", inserted.id, err);
    }

    results.push({
      id: inserted.id,
      filePath: inserted.filePath,
    });
  }

  return NextResponse.json(results);
}
