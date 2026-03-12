import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import { listBackups, startBackupCreation } from "@/lib/backups/service";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

export const runtime = "nodejs";

async function GETHandler(request: Request) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await listBackups());
}

async function POSTHandler(request: Request) {
  const unauthorized = await requireAdminAuth(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const operation = await startBackupCreation(name || undefined);
  return NextResponse.json(operation, { status: 202 });
}

export const GET = withApiRouteErrorLogging("/api/admin/backups", GETHandler);
export const POST = withApiRouteErrorLogging("/api/admin/backups", POSTHandler);
