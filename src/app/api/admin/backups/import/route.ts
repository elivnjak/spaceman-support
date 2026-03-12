import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { startBackupImport } from "@/lib/backups/service";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

export const runtime = "nodejs";

function decodeHeaderFileName(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded || null;
  } catch {
    const trimmed = value.trim();
    return trimmed || null;
  }
}

async function POSTHandler(request: Request) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const expectedLengthHeader = request.headers.get("content-length");
  const expectedLength = expectedLengthHeader ? Number.parseInt(expectedLengthHeader, 10) : Number.NaN;
  let fileName = decodeHeaderFileName(request.headers.get("x-backup-filename"));
  let buffer: Buffer;

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          error:
            "Failed to read the uploaded backup file. Please try again, or retry with a smaller file.",
        },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Upload a .tar.gz backup file in the 'file' field." },
        { status: 400 }
      );
    }

    fileName =
      fileName ||
      (typeof (file as File).name === "string" && (file as File).name.trim()
        ? (file as File).name.trim()
        : null);
    buffer = Buffer.from(await file.arrayBuffer());
  } else {
    const arrayBuffer = await request.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  if (buffer.length === 0) {
    return NextResponse.json({ error: "Backup upload was empty." }, { status: 400 });
  }

  if (Number.isFinite(expectedLength) && expectedLength > 0 && buffer.length < expectedLength) {
    return NextResponse.json(
      {
        error:
          "The uploaded backup did not reach the server completely. Restart the app so the latest upload size limit is active, then try uploading the file again.",
      },
      { status: 400 }
    );
  }

  if (!fileName) {
    fileName = `uploaded-backup-${Date.now()}.tar.gz`;
  }

  const operation = await startBackupImport(fileName, buffer);
  return NextResponse.json(operation, { status: 202 });
}

export const POST = withApiRouteErrorLogging("/api/admin/backups/import", POSTHandler);
