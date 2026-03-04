import { NextResponse } from "next/server";
import { and, avg, count, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireAdminUiAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions, playbooks } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function parseDateParam(value: string | null): { value: Date | null; invalid: boolean } {
  if (!value) return { value: null, invalid: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { value: null, invalid: true };
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { value: null, invalid: true };
  return { value: d, invalid: false };
}

async function GETHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const fromDateParsed = parseDateParam(searchParams.get("from"));
  const toDateParsed = parseDateParam(searchParams.get("to"));
  if (fromDateParsed.invalid || toDateParsed.invalid) {
    return NextResponse.json(
      { error: "Invalid date format. Expected YYYY-MM-DD." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const fromDate = fromDateParsed.value;
  const toDate = toDateParsed.value;
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json(
      { error: "Invalid date range. 'from' must be before or equal to 'to'." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

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
      avgTurnsResolved: avg(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' THEN ${diagnosticSessions.turnCount} END`
      ),
      avgTurnsEscalated: avg(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' THEN ${diagnosticSessions.turnCount} END`
      ),
      avgResolutionMinutes: avg(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved'
          THEN EXTRACT(EPOCH FROM (${diagnosticSessions.updatedAt} - ${diagnosticSessions.createdAt})) / 60
        END`
      ),
      verificationRequestedCount: count(
        sql`CASE WHEN ${diagnosticSessions.verificationRequestedAt} IS NOT NULL THEN 1 END`
      ),
      verificationRespondedCount: count(
        sql`CASE WHEN ${diagnosticSessions.verificationRespondedAt} IS NOT NULL THEN 1 END`
      ),
      openEscalatedTickets: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' AND ${diagnosticSessions.ticketStatus} = 'open' THEN 1 END`
      ),
      closedTickets: count(
        sql`CASE WHEN ${diagnosticSessions.ticketStatus} = 'closed' THEN 1 END`
      ),
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
  const avgTurnsResolved = summaryRow?.avgTurnsResolved
    ? Math.round(Number(summaryRow.avgTurnsResolved) * 10) / 10
    : null;
  const avgTurnsEscalated = summaryRow?.avgTurnsEscalated
    ? Math.round(Number(summaryRow.avgTurnsEscalated) * 10) / 10
    : null;
  const avgResolutionMinutes = summaryRow?.avgResolutionMinutes
    ? Math.round(Number(summaryRow.avgResolutionMinutes))
    : null;
  const verificationRequestedCount = Number(summaryRow?.verificationRequestedCount ?? 0);
  const verificationRespondedCount = Number(summaryRow?.verificationRespondedCount ?? 0);
  const verificationResponseRate =
    verificationRequestedCount > 0
      ? Math.round((verificationRespondedCount / verificationRequestedCount) * 1000) / 10
      : null;
  const openEscalatedTickets = Number(summaryRow?.openEscalatedTickets ?? 0);
  const closedTickets = Number(summaryRow?.closedTickets ?? 0);

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

  // ── Playbook breakdown ─────────────────────────────────────────────────────
  const playbookRows = await db
    .select({
      playbookId: diagnosticSessions.playbookId,
      title: playbooks.title,
      total: count(diagnosticSessions.id),
      resolved: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' THEN 1 END`
      ),
      escalated: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .leftJoin(playbooks, sql`${diagnosticSessions.playbookId} = ${playbooks.id}`)
    .where(
      whereClause
        ? and(whereClause, sql`${diagnosticSessions.playbookId} IS NOT NULL`)
        : sql`${diagnosticSessions.playbookId} IS NOT NULL`
    )
    .groupBy(diagnosticSessions.playbookId, playbooks.title)
    .orderBy(sql`count(${diagnosticSessions.id}) DESC`)
    .limit(10);

  const playbookBreakdown = playbookRows.map((row) => ({
    label: row.title ?? row.playbookId ?? "Unknown",
    total: Number(row.total),
    resolved: Number(row.resolved),
    escalated: Number(row.escalated),
    resolutionRate:
      Number(row.total) > 0
        ? Math.round((Number(row.resolved) / Number(row.total)) * 1000) / 10
        : 0,
  }));

  // ── Machine model breakdown ────────────────────────────────────────────────
  const machineModelRows = await db
    .select({
      machineModel: diagnosticSessions.machineModel,
      total: count(diagnosticSessions.id),
      resolved: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' THEN 1 END`
      ),
      escalated: count(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .where(
      whereClause
        ? and(whereClause, sql`${diagnosticSessions.machineModel} IS NOT NULL`)
        : sql`${diagnosticSessions.machineModel} IS NOT NULL`
    )
    .groupBy(diagnosticSessions.machineModel)
    .orderBy(sql`count(${diagnosticSessions.id}) DESC`)
    .limit(10);

  const machineModelBreakdown = machineModelRows.map((row) => ({
    label: row.machineModel ?? "Unknown",
    total: Number(row.total),
    resolved: Number(row.resolved),
    escalated: Number(row.escalated),
    resolutionRate:
      Number(row.total) > 0
        ? Math.round((Number(row.resolved) / Number(row.total)) * 1000) / 10
        : 0,
  }));

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

  return NextResponse.json(
    {
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
        avgTurnsResolved,
        avgTurnsEscalated,
        avgResolutionMinutes,
        verificationRequestedCount,
        verificationRespondedCount,
        verificationResponseRate,
        openEscalatedTickets,
        closedTickets,
      },
      resolutionOutcomes: {
        confirmed: Number(outcomesRow?.confirmed ?? 0),
        notFixed: Number(outcomesRow?.notFixed ?? 0),
        partiallyFixed: Number(outcomesRow?.partiallyFixed ?? 0),
        noResponse: Number(outcomesRow?.noResponse ?? 0),
      },
      escalationBreakdown,
      playbookBreakdown,
      machineModelBreakdown,
      dailySeries,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = withApiRouteErrorLogging("/api/admin/analytics", GETHandler);
