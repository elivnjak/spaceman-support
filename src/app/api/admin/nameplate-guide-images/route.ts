import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureNameplateTables } from "@/lib/db/ensure-nameplate-tables";
import { nameplateGuideImages } from "@/lib/db/schema";
import { nameplateGuideImagePath, sha256, writeStorageFile } from "@/lib/storage";

export async function GET() {
  await ensureNameplateTables();
  const rows = await db
    .select()
    .from(nameplateGuideImages)
    .orderBy(asc(nameplateGuideImages.createdAt));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  await ensureNameplateTables();
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
    const existing = await db.query.nameplateGuideImages.findFirst({
      where: (row, { eq: whereEq }) => whereEq(row.fileHash, hash),
    });
    if (existing) {
      results.push({ id: existing.id, filePath: existing.filePath, duplicate: true });
      continue;
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${hash.slice(0, 12)}_${Date.now()}.${ext}`;
    const relativePath = nameplateGuideImagePath(filename);
    const filePath = await writeStorageFile(relativePath, buffer);

    const [inserted] = await db
      .insert(nameplateGuideImages)
      .values({
        filePath,
        fileHash: hash,
        notes,
      })
      .returning({ id: nameplateGuideImages.id, filePath: nameplateGuideImages.filePath });
    results.push({ id: inserted.id, filePath: inserted.filePath });
  }

  return NextResponse.json(results);
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const [deleted] = await db
    .delete(nameplateGuideImages)
    .where(eq(nameplateGuideImages.id, id))
    .returning({ id: nameplateGuideImages.id });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
