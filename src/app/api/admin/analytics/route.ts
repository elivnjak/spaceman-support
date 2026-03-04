import { NextResponse } from "next/server";
import { and, avg, count, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireAdminUiAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function GETHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const fromDate = parseDateParam(searchParams.get("from"));
  const toDate = parseDateParam(searchParams.get("to"));

  // Build date range filter
  const dateFilters: SQL<unknown>[] = [];
  if (fromDate) {
    dateFilters.push(gte(diagnosticSessions.createdAt, fromDate));
  }
  if (toDate) {
    const endOfDay = new Date(toDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    dateFilters.push(lte(diagnosticSessions.createdAt, endOfDay));
  }
  const whereClause = dateFilters.length > 0 ? and(...dateFilters) : undefined;

  // ── Summary stats ─────────────────────────────────────────────────────────
  const [summaryRow] = await db
    .select({
      total: count(diagnosticSessions.id),
      resolved: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' THEN 1 END`
      ),
      escalated: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' THEN 1 END`
      ),
      active: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'active' THEN 1 END`
      ),
      frustrationCount: count(
        sql`CASE WHEN ${diagnosticSessions.frustrationTurnCount} > 0 THEN 1 END`
      ),
      avgTurnCount: avg(diagnosticSessions.turnCount),
    })
    .from(diagnosticSessions)
    .where(whereClause);

  const total = Number(summaryRow?.total ?? 0);
  const resolved = Number(summaryRow?.resolved ?? 0);
  const escalated = Number(summaryRow?.escalated ?? 0);
  const active = Number(summaryRow?.active ?? 0);
  const frustrationCount = Number(summaryRow?.frustrationCount ?? 0);
  const avgTurnCount = summaryRow?.avgTurnCount
    ? Math.round(Number(summaryRow.avgTurnCount) * 10) / 10
    : 0;

  const resolutionRate = total > 0 ? Math.round((resolved / total) * 1000) / 10 : 0;
  const escalationRate = total > 0 ? Math.round((escalated / total) * 1000) / 10 : 0;
  const frustrationRate = total > 0 ? Math.round((frustrationCount / total) * 1000) / 10 : 0;

  // ── Resolution outcomes ────────────────────────────────────────────────────
  const [outcomesRow] = await db
    .select({
      confirmed: count(
        sql`CASE WHEN ${diagnosticSessions.resolutionOutcome} = 'confirmed' THEN 1 END`
      ),
      notFixed: count(
        sql`CASE WHEN ${diagnosticSessions.resolutionOutcome} = 'not_fixed' THEN 1 END`
      ),
      partiallyFixed: count(
        sql`CASE WHEN ${diagnosticSessions.resolutionOutcome} = 'partially_fixed' THEN 1 END`
      ),
      noResponse: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' AND ${diagnosticSessions.resolutionOutcome} IS NULL THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .where(whereClause);

  // ── Escalation breakdown ───────────────────────────────────────────────────
  const escalationWhereFilters: SQL<unknown>[] = [
    sql`${diagnosticSessions.status} = 'escalated'`,
  ];
  if (dateFilters.length > 0) {
    escalationWhereFilters.push(...dateFilters);
  }
  const escalationWhere = and(...escalationWhereFilters);

  const [escalationRow] = await db
    .select({
      frustration: count(
        sql`CASE WHEN ${diagnosticSessions.escalationReason} ILIKE '%frustrat%' THEN 1 END`
      ),
      requestedHuman: count(
        sql`CASE WHEN (
          ${diagnosticSessions.escalationReason} ILIKE '%human%' OR
          ${diagnosticSessions.escalationReason} ILIKE '%agent%' OR
          ${diagnosticSessions.escalationReason} ILIKE '%speak%' OR
          ${diagnosticSessions.escalationReason} ILIKE '%talk to%'
        ) AND ${diagnosticSessions.escalationReason} NOT ILIKE '%frustrat%' THEN 1 END`
      ),
      turnLimit: count(
        sql`CASE WHEN (
          ${diagnosticSessions.escalationReason} ILIKE '%turn limit%' OR
          ${diagnosticSessions.escalationReason} ILIKE '%too many turn%'
        ) AND ${diagnosticSessions.escalationReason} NOT ILIKE '%frustrat%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%human%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%agent%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%speak%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%talk to%'
        THEN 1 END`
      ),
      safety: count(
        sql`CASE WHEN (
          ${diagnosticSessions.escalationReason} ILIKE '%safety%' OR
          ${diagnosticSessions.escalationReason} ILIKE '%controlled%'
        ) AND ${diagnosticSessions.escalationReason} NOT ILIKE '%frustrat%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%human%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%agent%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%speak%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%talk to%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%turn limit%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%too many turn%'
        THEN 1 END`
      ),
      playbook: count(
        sql`CASE WHEN ${diagnosticSessions.escalationReason} ILIKE '%playbook%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%frustrat%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%human%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%agent%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%speak%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%talk to%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%turn limit%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%too many turn%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%safety%'
          AND ${diagnosticSessions.escalationReason} NOT ILIKE '%controlled%'
        THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .where(escalationWhere);

  const esc = escalationRow ?? {
    frustration: 0,
    requestedHuman: 0,
    turnLimit: 0,
    safety: 0,
    playbook: 0,
  };
  const frustrationEsc = Number(esc.frustration);
  const requestedHumanEsc = Number(esc.requestedHuman);
  const turnLimitEsc = Number(esc.turnLimit);
  const safetyEsc = Number(esc.safety);
  const playbookEsc = Number(esc.playbook);
  const otherEsc = Math.max(
    0,
    escalated - frustrationEsc - requestedHumanEsc - turnLimitEsc - safetyEsc - playbookEsc
  );

  const escalationBreakdown = [
    { label: "Frustration", count: frustrationEsc },
    { label: "Requested human", count: requestedHumanEsc },
    { label: "Turn limit", count: turnLimitEsc },
    { label: "Safety trigger", count: safetyEsc },
    { label: "Playbook trigger", count: playbookEsc },
    { label: "Other", count: otherEsc },
  ].filter((item) => item.count > 0);

  // ── Daily time series ──────────────────────────────────────────────────────
  const dailyRows = await db
    .select({
      date: sql<string>`DATE(${diagnosticSessions.createdAt} AT TIME ZONE 'UTC')`,
      total: count(diagnosticSessions.id),
      resolved: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' THEN 1 END`
      ),
      escalated: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' THEN 1 END`
      ),
      active: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'active' THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .where(whereClause)
    .groupBy(sql`DATE(${diagnosticSessions.createdAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${diagnosticSessions.createdAt} AT TIME ZONE 'UTC')`);

  const dailySeries = dailyRows.map((row) => ({
    date: String(row.date),
    total: Number(row.total),
    resolved: Number(row.resolved),
    escalated: Number(row.escalated),
    active: Number(row.active),
  }));

  return NextResponse.json({
    summary: {
      total,
      resolved,
      escalated,
      active,
      resolutionRate,
      escalationRate,
      avgTurnCount,
      frustrationCount,
      frustrationRate,
    },
    resolutionOutcomes: {
      confirmed: Number(outcomesRow?.confirmed ?? 0),
      notFixed: Number(outcomesRow?.notFixed ?? 0),
      partiallyFixed: Number(outcomesRow?.partiallyFixed ?? 0),
      noResponse: Number(outcomesRow?.noResponse ?? 0),
    },
    escalationBreakdown,
    dailySeries,
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/analytics", GETHandler);
