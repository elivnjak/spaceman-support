import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { deleteBackup } from "@/lib/backups/service";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

export const runtime = "nodejs";

async function DELETEHandler(
  request: Request,
  { params }: { params: Promise<{ backupId: string }> }
) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  const { backupId } = await params;
  await deleteBackup(backupId);
  return NextResponse.json({ ok: true });
}

export const DELETE = withApiRouteErrorLogging("/api/admin/backups/[backupId]", DELETEHandler);
