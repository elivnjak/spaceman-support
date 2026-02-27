import path from "path";
import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { readStorageFile, diagnosticSessionImagePath } from "@/lib/storage";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

function getContentType(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/** 1x1 transparent GIF so missing images don't break Next.js Image */
const PLACEHOLDER_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; path: string[] }> }
) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const { sessionId, path: restPath } = await params;
  const filename = Array.isArray(restPath) ? restPath.join("/") : String(restPath ?? "").trim();
  if (!filename || filename.includes("..") || filename.includes("\0")) {
    return NextResponse.json({ error: "Invalid image path." }, { status: 400 });
  }

  const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "Unsupported image type." }, { status: 400 });
  }

  try {
    const relPath = diagnosticSessionImagePath(sessionId, filename);
    const buffer = await readStorageFile(relPath);
    if (!buffer || buffer.length === 0) {
      return new NextResponse(PLACEHOLDER_GIF, {
        status: 200,
        headers: { "Content-Type": "image/gif", "X-Image-Status": "placeholder" },
      });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": getContentType(ext),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(PLACEHOLDER_GIF, {
      status: 200,
      headers: { "Content-Type": "image/gif", "X-Image-Status": "not-found" },
    });
  }
}

export const GET = withApiRouteErrorLogging("/api/admin/audit-logs/[sessionId]/image/[...path]", GETHandler);
