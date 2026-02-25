import path from "path";
import { NextResponse } from "next/server";
import { readStorageFile, diagnosticSessionImagePath } from "@/lib/storage";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

function getContentType(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Serves stored diagnostic session images so restored chat sessions can display
 * user-uploaded photos. No auth: session ID is the capability (same as GET session).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; path: string[] }> }
) {
  const { sessionId, path: pathSegments } = await params;
  const filename = Array.isArray(pathSegments)
    ? pathSegments.join("/")
    : String(pathSegments ?? "").trim();

  if (
    !filename ||
    filename.includes("..") ||
    filename.includes("\0") ||
    /[\\/]/.test(filename)
  ) {
    return NextResponse.json({ error: "Invalid image path." }, { status: 400 });
  }

  const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: "Unsupported image type." },
      { status: 400 }
    );
  }

  try {
    const relPath = diagnosticSessionImagePath(sessionId, filename);
    const buffer = await readStorageFile(relPath);
    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": getContentType(ext),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
