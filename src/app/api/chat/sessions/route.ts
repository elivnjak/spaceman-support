import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { requireAdminAuth } from "@/lib/auth";

async function GETHandler(request: Request) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const list = await db
    .select({
      id: diagnosticSessions.id,
      status: diagnosticSessions.status,
      phase: diagnosticSessions.phase,
      turnCount: diagnosticSessions.turnCount,
      machineModel: diagnosticSessions.machineModel,
      createdAt: diagnosticSessions.createdAt,
    })
    .from(diagnosticSessions)
    .orderBy(desc(diagnosticSessions.updatedAt))
    .limit(50);
  return NextResponse.json(list);
}

export const GET = withApiRouteErrorLogging("/api/chat/sessions", GETHandler);
