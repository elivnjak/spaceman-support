import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { evidenceGuideImages } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { resolveStoredFilePath } from "@/lib/storage";

async function GETHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.evidenceGuideImages.findFirst({
    where: eq(evidenceGuideImages.id, id),
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const filePath = resolveStoredFilePath(row.filePath);
    const buffer = await readFile(filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
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

export const GET = withApiRouteErrorLogging("/api/evidence-guide-image/[id]", GETHandler);
