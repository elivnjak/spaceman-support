import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, diagnosticSessions, playbooks } from "@/lib/db/schema";
import { deleteDiagnosticSessionStorage } from "@/lib/storage";
import { logErrorEvent, withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const { sessionId } = await params;
  const [session] = await db
    .select({
      id: diagnosticSessions.id,
      machineModel: diagnosticSessions.machineModel,
      serialNumber: diagnosticSessions.serialNumber,
      productType: diagnosticSessions.productType,
      status: diagnosticSessions.status,
      phase: diagnosticSessions.phase,
      playbookId: diagnosticSessions.playbookId,
      playbookTitle: playbooks.title,
      turnCount: diagnosticSessions.turnCount,
      createdAt: diagnosticSessions.createdAt,
      updatedAt: diagnosticSessions.updatedAt,
    })
    .from(diagnosticSessions)
    .leftJoin(playbooks, eq(diagnosticSessions.playbookId, playbooks.id))
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

async function DELETEHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const { sessionId } = await params;
  const [existingSession] = await db
    .select({ id: diagnosticSessions.id })
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);

  if (!existingSession) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  try {
    await deleteDiagnosticSessionStorage(sessionId);
  } catch (error) {
    console.error("Failed to delete diagnostic session files:", sessionId, error);
    await logErrorEvent({
      level: "error",
      route: "/api/admin/audit-logs/[sessionId]",
      sessionId,
      message: "Failed to delete diagnostic session files.",
      error,
      context: {
        targetSessionId: sessionId,
      },
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to delete session files." },
      { status: 500 }
    );
  }

  await db.delete(diagnosticSessions).where(eq(diagnosticSessions.id, sessionId));
  return new NextResponse(null, { status: 204 });
}

export const GET = withApiRouteErrorLogging("/api/admin/audit-logs/[sessionId]", GETHandler);
export const DELETE = withApiRouteErrorLogging("/api/admin/audit-logs/[sessionId]", DELETEHandler);
