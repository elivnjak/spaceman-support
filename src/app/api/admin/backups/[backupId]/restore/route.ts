import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { startBackupRestore } from "@/lib/backups/service";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

export const runtime = "nodejs";

async function POSTHandler(
  request: Request,
  { params }: { params: Promise<{ backupId: string }> }
) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  const { backupId } = await params;
  const operation = await startBackupRestore(backupId);
  return NextResponse.json(operation, { status: 202 });
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/backups/[backupId]/restore",
  POSTHandler
);
