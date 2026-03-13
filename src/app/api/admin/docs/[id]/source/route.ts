import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { resolveStoredFilePath } from "@/lib/storage";

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".md" || ext === ".markdown") return "text/markdown; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function GETHandler(
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

  if (doc.filePath === "_url") {
    if (!doc.sourceUrl) {
      return NextResponse.json(
        { error: "No source URL found for this document." },
        { status: 404 }
      );
    }
    return NextResponse.redirect(doc.sourceUrl);
  }

  if (doc.filePath === "_pasted") {
    const content = doc.pastedContent ?? "";
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${doc.title || "document"}.txt"`,
      },
    });
  }

  try {
    const filePath = resolveStoredFilePath(doc.filePath);
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": guessContentType(filePath),
        "Content-Disposition": `inline; filename="${path.basename(filePath)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Source file not found on disk." }, { status: 404 });
  }
}

export const GET = withApiRouteErrorLogging(
  "/api/admin/docs/[id]/source",
  GETHandler
);
