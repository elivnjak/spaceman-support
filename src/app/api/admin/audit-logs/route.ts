import { NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, diagnosticSessions } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type SessionSummary = {
  sessionId: string;
  logCount: number;
  lastLogAt: string | null;
  status: string | null;
  phase: string | null;
  turnCount: number | null;
  machineModel: string | null;
  serialNumber: string | null;
  productType: string | null;
  playbookId: string | null;
};

async function GETHandler(request: Request) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const rows = await db
    .select({
      sessionId: auditLogs.sessionId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt));

  if (rows.length === 0) return NextResponse.json([]);

  const summaryMap = new Map<string, { count: number; lastLogAt: string | null }>();
  for (const row of rows) {
    const existing = summaryMap.get(row.sessionId);
    const createdAtIso = row.createdAt ? new Date(row.createdAt).toISOString() : null;
    if (existing) {
      existing.count += 1;
      if (!existing.lastLogAt && createdAtIso) existing.lastLogAt = createdAtIso;
    } else {
      summaryMap.set(row.sessionId, { count: 1, lastLogAt: createdAtIso });
    }
  }

  const sessionIds = Array.from(summaryMap.keys());
  const sessions = await db
    .select({
      id: diagnosticSessions.id,
      status: diagnosticSessions.status,
      phase: diagnosticSessions.phase,
      turnCount: diagnosticSessions.turnCount,
      machineModel: diagnosticSessions.machineModel,
      serialNumber: diagnosticSessions.serialNumber,
      productType: diagnosticSessions.productType,
      playbookId: diagnosticSessions.playbookId,
    })
    .from(diagnosticSessions)
    .where(inArray(diagnosticSessions.id, sessionIds));

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const result: SessionSummary[] = sessionIds.map((sessionId) => {
    const summary = summaryMap.get(sessionId)!;
    const session = sessionById.get(sessionId);
    return {
      sessionId,
      logCount: summary.count,
      lastLogAt: summary.lastLogAt,
      status: session?.status ?? null,
      phase: session?.phase ?? null,
      turnCount: session?.turnCount ?? null,
      machineModel: session?.machineModel ?? null,
      serialNumber: session?.serialNumber ?? null,
      productType: session?.productType ?? null,
      playbookId: session?.playbookId ?? null,
    };
  });

  return NextResponse.json(result);
}

export const GET = withApiRouteErrorLogging("/api/admin/audit-logs", GETHandler);
