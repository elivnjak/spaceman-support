import { NextResponse } from "next/server";
import { and, avg, count, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireAdminUiAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions, labels, playbooks } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function parseDateParam(value: string | null): { value: Date | null; invalid: boolean } {
  if (!value) return { value: null, invalid: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { value: null, invalid: true };
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { value: null, invalid: true };
  return { value: d, invalid: false };
}

type EscalationReasonItem = {
  reason: string;
  count: number;
};

type PlaybookStat = {
  playbookId: string;
  title: string;
  labelId: string;
  labelName: string;
  total: number;
  resolved: number;
  escalated: number;
  active: number;
  resolutionRate: number;
  escalationRate: number;
  frustrationRate: number;
  avgTurns: number | null;
  avgTurnsResolved: number | null;
  avgTurnsEscalated: number | null;
  verificationRequestedCount: number;
  verificationRespondedCount: number;
  verificationResponseRate: number | null;
  notFixedCount: number;
  partiallyFixedCount: number;
  topEscalationReasons: EscalationReasonItem[];
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const DIAGNOSIS_MODE_DISABLED_REASON_PREFIX =
  "Diagnosis mode is disabled for public users; escalating after intake collection.";

const DIAGNOSIS_MODE_DISABLED_FILTER = sql`(
  COALESCE(${diagnosticSessions.escalationReason}, '') ILIKE ${`${DIAGNOSIS_MODE_DISABLED_REASON_PREFIX}%`}
  OR COALESCE(${diagnosticSessions.escalationHandoff} ->> 'labelId', '') = 'diagnosis_mode_disabled'
)`;

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
  const analyticsWhereClause = whereClause
    ? and(whereClause, sql`NOT (${DIAGNOSIS_MODE_DISABLED_FILTER})`)
    : sql`NOT (${DIAGNOSIS_MODE_DISABLED_FILTER})`;

  const withWhere = (extraCondition?: SQL<unknown>): SQL<unknown> | undefined => {
    if (analyticsWhereClause && extraCondition) return and(analyticsWhereClause, extraCondition);
    return analyticsWhereClause ?? extraCondition;
  };

  const [excludedSessionsRow] = await db
    .select({ total: count(diagnosticSessions.id) })
    .from(diagnosticSessions)
    .where(
      whereClause ? and(whereClause, DIAGNOSIS_MODE_DISABLED_FILTER) : DIAGNOSIS_MODE_DISABLED_FILTER
    );
  const excludedDiagnosisModeDisabledSessions = Number(excludedSessionsRow?.total ?? 0);

  const [summaryRow] = await db
    .select({
      totalSessions: count(diagnosticSessions.id),
      matchedSessions: count(
        sql`CASE WHEN ${diagnosticSessions.playbookId} IS NOT NULL THEN 1 END`
      ),
      unmatchedSessions: count(
        sql`CASE WHEN ${diagnosticSessions.playbookId} IS NULL THEN 1 END`
      ),
      avgTriageRound: avg(diagnosticSessions.triageRound),
      multiRoundSessions: count(
        sql`CASE WHEN ${diagnosticSessions.triageRound} > 1 THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .where(analyticsWhereClause);

  const totalSessions = Number(summaryRow?.totalSessions ?? 0);
  const matchedSessions = Number(summaryRow?.matchedSessions ?? 0);
  const unmatchedSessions = Number(summaryRow?.unmatchedSessions ?? 0);
  const avgTriageRound = summaryRow?.avgTriageRound
    ? round1(Number(summaryRow.avgTriageRound))
    : 0;
  const multiRoundSessions = Number(summaryRow?.multiRoundSessions ?? 0);
  const multiRoundTriageRate =
    totalSessions > 0 ? round1((multiRoundSessions / totalSessions) * 100) : 0;

  const playbookRows = await db
    .select({
      playbookId: diagnosticSessions.playbookId,
      title: playbooks.title,
      labelId: playbooks.labelId,
      labelName: labels.displayName,
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
      frustrated: count(
        sql`CASE WHEN ${diagnosticSessions.frustrationTurnCount} > 0 THEN 1 END`
      ),
      avgTurns: avg(diagnosticSessions.turnCount),
      avgTurnsResolved: avg(
        sql`CASE WHEN ${diagnosticSessions.status} = 'resolved' THEN ${diagnosticSessions.turnCount} END`
      ),
      avgTurnsEscalated: avg(
        sql`CASE WHEN ${diagnosticSessions.status} = 'escalated' THEN ${diagnosticSessions.turnCount} END`
      ),
      verificationRequestedCount: count(
        sql`CASE WHEN ${diagnosticSessions.verificationRequestedAt} IS NOT NULL THEN 1 END`
      ),
      verificationRespondedCount: count(
        sql`CASE WHEN ${diagnosticSessions.verificationRespondedAt} IS NOT NULL THEN 1 END`
      ),
      notFixedCount: count(
        sql`CASE WHEN ${diagnosticSessions.resolutionOutcome} = 'not_fixed' THEN 1 END`
      ),
      partiallyFixedCount: count(
        sql`CASE WHEN ${diagnosticSessions.resolutionOutcome} = 'partially_fixed' THEN 1 END`
      ),
    })
    .from(diagnosticSessions)
    .leftJoin(playbooks, eq(diagnosticSessions.playbookId, playbooks.id))
    .leftJoin(labels, eq(playbooks.labelId, labels.id))
    .where(withWhere(sql`${diagnosticSessions.playbookId} IS NOT NULL`))
    .groupBy(
      diagnosticSessions.playbookId,
      playbooks.title,
      playbooks.labelId,
      labels.displayName
    )
    .orderBy(sql`count(${diagnosticSessions.id}) DESC`);

  const escalationReasonsRows = await db
    .select({
      playbookId: diagnosticSessions.playbookId,
      reason: diagnosticSessions.escalationReason,
      total: count(diagnosticSessions.id),
    })
    .from(diagnosticSessions)
    .where(
      withWhere(sql`${diagnosticSessions.playbookId} IS NOT NULL
        AND ${diagnosticSessions.status} = 'escalated'
        AND ${diagnosticSessions.escalationReason} IS NOT NULL
        AND LENGTH(TRIM(${diagnosticSessions.escalationReason})) > 0`)
    )
    .groupBy(diagnosticSessions.playbookId, diagnosticSessions.escalationReason);

  const reasonMap = new Map<string, EscalationReasonItem[]>();
  for (const row of escalationReasonsRows) {
    const playbookId = row.playbookId;
    const reason = row.reason;
    if (!playbookId || !reason) continue;
    const list = reasonMap.get(playbookId) ?? [];
    list.push({
      reason,
      count: Number(row.total),
    });
    reasonMap.set(playbookId, list);
  }
  for (const [key, list] of reasonMap.entries()) {
    list.sort((a, b) => b.count - a.count);
    reasonMap.set(key, list.slice(0, 5));
  }

  const playbookStats: PlaybookStat[] = playbookRows
    .filter((row): row is typeof row & { playbookId: string; title: string; labelId: string } => {
      return !!row.playbookId && !!row.title && !!row.labelId;
    })
    .map((row) => {
      const total = Number(row.total);
      const resolved = Number(row.resolved);
      const escalated = Number(row.escalated);
      const frustrated = Number(row.frustrated);
      const verificationRequestedCount = Number(row.verificationRequestedCount);
      const verificationRespondedCount = Number(row.verificationRespondedCount);
      return {
        playbookId: row.playbookId,
        title: row.title,
        labelId: row.labelId,
        labelName: row.labelName ?? row.labelId,
        total,
        resolved,
        escalated,
        active: Number(row.active),
        resolutionRate: total > 0 ? round1((resolved / total) * 100) : 0,
        escalationRate: total > 0 ? round1((escalated / total) * 100) : 0,
        frustrationRate: total > 0 ? round1((frustrated / total) * 100) : 0,
        avgTurns: row.avgTurns == null ? null : round1(Number(row.avgTurns)),
        avgTurnsResolved:
          row.avgTurnsResolved == null ? null : round1(Number(row.avgTurnsResolved)),
        avgTurnsEscalated:
          row.avgTurnsEscalated == null ? null : round1(Number(row.avgTurnsEscalated)),
        verificationRequestedCount,
        verificationRespondedCount,
        verificationResponseRate:
          verificationRequestedCount > 0
            ? round1((verificationRespondedCount / verificationRequestedCount) * 100)
            : null,
        notFixedCount: Number(row.notFixedCount),
        partiallyFixedCount: Number(row.partiallyFixedCount),
        topEscalationReasons: reasonMap.get(row.playbookId) ?? [],
      };
    });

  const unmatchedMachineRows = await db
    .select({
      label: diagnosticSessions.machineModel,
      total: count(diagnosticSessions.id),
    })
    .from(diagnosticSessions)
    .where(
      withWhere(sql`${diagnosticSessions.playbookId} IS NULL
        AND ${diagnosticSessions.machineModel} IS NOT NULL
        AND LENGTH(TRIM(${diagnosticSessions.machineModel})) > 0`)
    )
    .groupBy(diagnosticSessions.machineModel)
    .orderBy(sql`count(${diagnosticSessions.id}) DESC`)
    .limit(8);

  const unmatchedProductTypeRows = await db
    .select({
      label: diagnosticSessions.productType,
      total: count(diagnosticSessions.id),
    })
    .from(diagnosticSessions)
    .where(
      withWhere(sql`${diagnosticSessions.playbookId} IS NULL
        AND ${diagnosticSessions.productType} IS NOT NULL
        AND LENGTH(TRIM(${diagnosticSessions.productType})) > 0`)
    )
    .groupBy(diagnosticSessions.productType)
    .orderBy(sql`count(${diagnosticSessions.id}) DESC`)
    .limit(8);

  const playbookMetadataRows = await db
    .select({
      id: playbooks.id,
      title: playbooks.title,
      labelId: playbooks.labelId,
      labelName: labels.displayName,
      symptoms: playbooks.symptoms,
      evidenceChecklist: playbooks.evidenceChecklist,
      candidateCauses: playbooks.candidateCauses,
      escalationTriggers: playbooks.escalationTriggers,
      steps: playbooks.steps,
      updatedAt: playbooks.updatedAt,
    })
    .from(playbooks)
    .leftJoin(labels, eq(playbooks.labelId, labels.id))
    .orderBy(playbooks.title);

  const asCount = (value: unknown): number =>
    Array.isArray(value) ? value.length : 0;

  const playbookMetadata = playbookMetadataRows.map((row) => ({
    playbookId: row.id,
    title: row.title,
    labelId: row.labelId,
    labelName: row.labelName ?? row.labelId,
    stepCount: asCount(row.steps),
    symptomCount: asCount(row.symptoms),
    evidenceItemCount: asCount(row.evidenceChecklist),
    candidateCauseCount: asCount(row.candidateCauses),
    questionCount: 0,
    triggerCount: asCount(row.escalationTriggers),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }));

  return NextResponse.json(
    {
      summary: {
        totalSessions,
        matchedSessions,
        unmatchedSessions,
        excludedDiagnosisModeDisabledSessions,
        avgTriageRound,
        multiRoundSessions,
        multiRoundTriageRate,
      },
      playbookStats,
      coverageGaps: {
        unmatchedSessions,
        topUnmatchedMachineModels: unmatchedMachineRows.map((row) => ({
          label: row.label ?? "Unknown",
          count: Number(row.total),
        })),
        topUnmatchedProductTypes: unmatchedProductTypeRows.map((row) => ({
          label: row.label ?? "Unknown",
          count: Number(row.total),
        })),
      },
      playbookMetadata,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = withApiRouteErrorLogging("/api/admin/ai-analytics", GETHandler);
