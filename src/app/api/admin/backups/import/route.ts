import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { startBackupImport } from "@/lib/backups/service";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

export const runtime = "nodejs";

async function POSTHandler(request: Request) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Upload a .tar.gz backup file in the 'file' field." },
      { status: 400 }
    );
  }

  const fileName =
    typeof (file as File).name === "string" && (file as File).name.trim()
      ? (file as File).name.trim()
      : `uploaded-backup-${Date.now()}.tar.gz`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const operation = await startBackupImport(fileName, buffer);
  return NextResponse.json(operation, { status: 202 });
}

export const POST = withApiRouteErrorLogging("/api/admin/backups/import", POSTHandler);
