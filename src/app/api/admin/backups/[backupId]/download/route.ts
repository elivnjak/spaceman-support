import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { getBackupDownloadInfo } from "@/lib/backups/service";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

export const runtime = "nodejs";

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ backupId: string }> }
) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  const { backupId } = await params;
  const { record, archivePath } = await getBackupDownloadInfo(backupId);
  const archiveStat = await stat(archivePath);
  const stream = Readable.toWeb(createReadStream(archivePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${record.archiveFileName}"`,
      "Content-Length": String(archiveStat.size),
    },
  });
}

export const GET = withApiRouteErrorLogging(
  "/api/admin/backups/[backupId]/download",
  GETHandler
);
