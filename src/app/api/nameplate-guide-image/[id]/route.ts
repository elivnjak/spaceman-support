import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nameplateGuideImages } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.nameplateGuideImages.findFirst({
    where: eq(nameplateGuideImages.id, id),
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const buffer = await readFile(row.filePath);
    const ext = row.filePath.split(".").pop()?.toLowerCase() || "jpg";
    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
    return new NextResponse(buffer, { headers: { "Content-Type": contentType } });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
