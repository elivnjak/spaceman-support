import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, diagnosticSessions } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const { sessionId } = await params;
  const [session] = await db
    .select()
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.sessionId, sessionId))
    .orderBy(asc(auditLogs.turnNumber), asc(auditLogs.createdAt));

  return NextResponse.json({
    session,
    logs: logs.map((entry) => ({
      id: entry.id,
      sessionId: entry.sessionId,
      turnNumber: entry.turnNumber,
      payload: entry.payload,
      createdAt: entry.createdAt,
    })),
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/audit-logs/[sessionId]", GETHandler);
