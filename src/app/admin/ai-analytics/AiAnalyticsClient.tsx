"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatDateTimeAu } from "@/lib/date-format";

type Preset = "today" | "7d" | "30d" | "90d" | "all" | "custom";

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

type CoverageBucket = {
  label: string;
  count: number;
};

type AnalyticsPayload = {
  summary: {
    totalSessions: number;
    matchedSessions: number;
    unmatchedSessions: number;
    excludedDiagnosisModeDisabledSessions: number;
    avgTriageRound: number;
    multiRoundSessions: number;
    multiRoundTriageRate: number;
  };
  playbookStats: PlaybookStat[];
  coverageGaps: {
    unmatchedSessions: number;
    topUnmatchedMachineModels: CoverageBucket[];
    topUnmatchedProductTypes: CoverageBucket[];
  };
  playbookMetadata: Array<{
    playbookId: string;
    title: string;
    labelId: string;
    labelName: string;
    stepCount: number;
    symptomCount: number;
    evidenceItemCount: number;
    candidateCauseCount: number;
    questionCount: number;
    triggerCount: number;
    updatedAt: string | null;
  }>;
};

type Recommendation = {
  type:
    | "improve_playbook"
    | "create_playbook"
    | "add_trigger"
    | "review_coverage"
    | "process_change";
  priority: "high" | "medium" | "low";
  playbookId: string | null;
  playbookTitle: string | null;
  title: string;
  insight: string;
  action: string;
  impact: string;
};

type RecommendationResult = {
  healthScore: number | null;
  summary: string;
  recommendations: Recommendation[];
  rawText?: string;
};

type RecommendationHistoryItem = {
  createdAt: string;
  preset: Preset;
  from: string;
  to: string;
  healthScore: number | null;
  recommendationCount: number;
  summary: string;
};

type SortField =
  | "title"
  | "total"
  | "resolutionRate"
  | "escalationRate"
  | "avgTurns"
  | "frustrationRate"
  | "verificationResponseRate";

const PRESET_BUTTONS: Array<{ id: Preset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "all", label: "All time" },
];

const RECOMMENDATION_HISTORY_KEY = "aiAnalyticsRecommendationHistoryV1";

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const toStr = now.toISOString().split("T")[0];
  if (preset === "today") return { from: toStr, to: toStr };
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().split("T")[0], to: toStr };
}

function fmt(value: number): string {
  return value.toLocaleString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPreviousRange(
  preset: Preset,
  from: string,
  to: string
): { from: string; to: string } | null {
  if (preset === "all" || !from || !to) return null;
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;

  const rangeDays =
    Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const prevToDate = new Date(fromDate);
  prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);
  const prevFromDate = new Date(prevToDate);
  prevFromDate.setUTCDate(prevFromDate.getUTCDate() - (rangeDays - 1));

  return {
    from: prevFromDate.toISOString().split("T")[0],
    to: prevToDate.toISOString().split("T")[0],
  };
}

function fmtPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value}%`;
}

function metricClass(value: number | null, goodHigh = true): string {
  if (value == null) return "text-muted";
  if (goodHigh) {
    if (value >= 70) return "text-green-600 dark:text-green-400";
    if (value >= 40) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  }
  if (value <= 15) return "text-green-600 dark:text-green-400";
  if (value <= 30) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function priorityClass(priority: Recommendation["priority"]): string {
  if (priority === "high") return "border-red-300 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20";
  if (priority === "medium")
    return "border-amber-300 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20";
  return "border-emerald-300 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20";
}

function deltaClass(
  current: number | null | undefined,
  previous: number | null | undefined,
  goodWhenHigher: boolean
): string {
  if (current == null || previous == null) return "text-muted";
  const delta = current - previous;
  if (delta === 0) return "text-muted";
  const good = goodWhenHigher ? delta > 0 : delta < 0;
  return good
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
}

export function AiAnalyticsClient() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortField, setSortField] = useState<SortField>("total");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [recommendationResult, setRecommendationResult] =
    useState<RecommendationResult | null>(null);
  const [comparisonData, setComparisonData] = useState<AnalyticsPayload | null>(null);
  const [recommendationHistory, setRecommendationHistory] = useState<
    RecommendationHistoryItem[]
  >([]);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    if (preset === "all") return { from: "", to: "" };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  const previousRange = useMemo(
    () => getPreviousRange(preset, from, to),
    [preset, from, to]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECOMMENDATION_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as RecommendationHistoryItem[];
      if (Array.isArray(parsed)) setRecommendationHistory(parsed.slice(0, 10));
    } catch {
      // Ignore malformed local history.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setComparisonData(null);

    const buildUrl = (rangeFrom: string, rangeTo: string) => {
      const params = new URLSearchParams();
      if (rangeFrom) params.set("from", rangeFrom);
      if (rangeTo) params.set("to", rangeTo);
      return `/api/admin/ai-analytics?${params.toString()}`;
    };

    const load = async () => {
      const currentRes = await fetch(buildUrl(from, to), { signal: controller.signal });
      if (!currentRes.ok) {
        const body = (await currentRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to load Insights.");
      }
      const currentPayload = (await currentRes.json()) as AnalyticsPayload;
      setData(currentPayload);

      if (!previousRange) return;
      const prevRes = await fetch(buildUrl(previousRange.from, previousRange.to), {
        signal: controller.signal,
      });
      if (!prevRes.ok) return;
      const prevPayload = (await prevRes.json()) as AnalyticsPayload;
      setComparisonData(prevPayload);
    };

    load()
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load Insights.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [from, to, previousRange]);

  const sortedPlaybooks = useMemo(() => {
    const rows = [...(data?.playbookStats ?? [])];
    rows.sort((a, b) => {
      const getValue = (row: PlaybookStat): string | number => {
        switch (sortField) {
          case "title":
            return row.title.toLowerCase();
          case "total":
            return row.total;
          case "resolutionRate":
            return row.resolutionRate;
          case "escalationRate":
            return row.escalationRate;
          case "avgTurns":
            return row.avgTurns ?? -1;
          case "frustrationRate":
            return row.frustrationRate;
          case "verificationResponseRate":
            return row.verificationResponseRate ?? -1;
          default:
            return row.total;
        }
      };
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === "string" && typeof vb === "string") {
        return sortDirection === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const diff = Number(va) - Number(vb);
      return sortDirection === "asc" ? diff : -diff;
    });
    return rows;
  }, [data?.playbookStats, sortField, sortDirection]);

  const recommendationsByPriority = useMemo(() => {
    const groups: Record<Recommendation["priority"], Recommendation[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const item of recommendationResult?.recommendations ?? []) {
      groups[item.priority].push(item);
    }
    return groups;
  }, [recommendationResult]);

  const comparisonByPlaybookId = useMemo(() => {
    const map = new Map<string, PlaybookStat>();
    for (const row of comparisonData?.playbookStats ?? []) {
      map.set(row.playbookId, row);
    }
    return map;
  }, [comparisonData]);

  const historySparkline = useMemo(() => {
    const points = recommendationHistory
      .slice(0, 10)
      .map((item) => item.healthScore)
      .filter((score): score is number => score != null);
    if (points.length < 2) return null;
    const width = 120;
    const height = 36;
    const max = Math.max(...points, 100);
    const min = Math.min(...points, 0);
    const span = Math.max(1, max - min);
    const coordinates = points
      .map((value, index) => {
        const x = (index / (points.length - 1)) * width;
        const y = height - ((value - min) / span) * height;
        return `${x},${clamp(y, 0, height)}`;
      })
      .join(" ");
    return { width, height, coordinates };
  }, [recommendationHistory]);

  const onSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection(field === "title" ? "asc" : "desc");
  };

  const getDeltaLabel = (
    current: number | undefined,
    previous: number | undefined,
    suffix = ""
  ): string | null => {
    if (current == null || previous == null) return null;
    const delta = Math.round((current - previous) * 10) / 10;
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta}${suffix} vs previous`;
  };

  const clearRecommendationHistory = () => {
    setRecommendationHistory([]);
    localStorage.removeItem(RECOMMENDATION_HISTORY_KEY);
  };

  const exportPlaybookCsv = () => {
    if (!sortedPlaybooks.length) return;
    const headers = [
      "Playbook",
      "Label",
      "Sessions",
      "Resolved",
      "Escalated",
      "Active",
      "ResolutionRatePercent",
      "EscalationRatePercent",
      "AvgTurns",
      "FrustrationRatePercent",
      "VerificationResponseRatePercent",
      "NotFixedCount",
      "PartiallyFixedCount",
    ];
    const rows = sortedPlaybooks.map((row) => [
      row.title,
      row.labelName,
      String(row.total),
      String(row.resolved),
      String(row.escalated),
      String(row.active),
      String(row.resolutionRate),
      String(row.escalationRate),
      row.avgTurns == null ? "" : String(row.avgTurns),
      String(row.frustrationRate),
      row.verificationResponseRate == null ? "" : String(row.verificationResponseRate),
      String(row.notFixedCount),
      String(row.partiallyFixedCount),
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-playbook-analytics-${from || "all"}-${to || "all"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runRecommendationAnalysis = async () => {
    if (!data || recommendationLoading) return;
    setRecommendationLoading(true);
    setRecommendationError(null);
    try {
      const res = await fetch("/api/admin/ai-analytics/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analytics: data }),
      });
      const payload = (await res.json().catch(() => null)) as RecommendationResult | null;
      if (!res.ok || !payload) {
        const err = (payload as { error?: string } | null)?.error;
        throw new Error(err ?? "Failed to generate recommendations.");
      }
      setRecommendationResult(payload);
      const nextHistory: RecommendationHistoryItem[] = [
        {
          createdAt: new Date().toISOString(),
          preset,
          from,
          to,
          healthScore: payload.healthScore,
          recommendationCount: payload.recommendations.length,
          summary: payload.summary,
        },
        ...recommendationHistory,
      ].slice(0, 10);
      setRecommendationHistory(nextHistory);
      localStorage.setItem(RECOMMENDATION_HISTORY_KEY, JSON.stringify(nextHistory));
    } catch (err: unknown) {
      setRecommendationError(
        err instanceof Error ? err.message : "Failed to generate recommendations."
      );
    } finally {
      setRecommendationLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PRESET_BUTTONS.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setPreset(btn.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                preset === btn.id && preset !== "custom"
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-ink hover:bg-page"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              setPreset("custom");
            }}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
            aria-label="From date"
          />
          <span className="text-sm text-muted">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              setPreset("custom");
            }}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
            aria-label="To date"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm font-medium text-muted">Total sessions</p>
          <p className="mt-2 text-3xl font-bold text-ink tabular-nums">
            {loading ? "—" : fmt(data?.summary.totalSessions ?? 0)}
          </p>
          <p className="mt-1 text-sm text-muted">
            {loading
              ? "—"
              : `${fmt(data?.summary.matchedSessions ?? 0)} matched to playbooks${
                  (data?.summary.excludedDiagnosisModeDisabledSessions ?? 0) > 0
                    ? ` • excludes ${fmt(
                        data?.summary.excludedDiagnosisModeDisabledSessions ?? 0
                      )} intake-only escalations`
                    : ""
                }`}
          </p>
          {!loading && comparisonData && (
            <p className="mt-1 text-xs text-muted">
              {getDeltaLabel(
                data?.summary.totalSessions,
                comparisonData.summary.totalSessions
              )}
            </p>
          )}
        </Card>
        <Card>
          <p className="text-sm font-medium text-muted">Coverage gaps</p>
          <p className="mt-2 text-3xl font-bold text-orange-600 dark:text-orange-400 tabular-nums">
            {loading ? "—" : fmt(data?.coverageGaps.unmatchedSessions ?? 0)}
          </p>
          <p className="mt-1 text-sm text-muted">Sessions with no matched playbook</p>
          {!loading && comparisonData && (
            <p className="mt-1 text-xs text-muted">
              {getDeltaLabel(
                data?.coverageGaps.unmatchedSessions,
                comparisonData.coverageGaps.unmatchedSessions
              )}
            </p>
          )}
        </Card>
        <Card>
          <p className="text-sm font-medium text-muted">Avg triage rounds</p>
          <p className="mt-2 text-3xl font-bold text-ink tabular-nums">
            {loading ? "—" : data?.summary.avgTriageRound ?? 0}
          </p>
          <p className="mt-1 text-sm text-muted">
            {loading ? "—" : `${data?.summary.multiRoundTriageRate ?? 0}% needed multiple rounds`}
          </p>
          {!loading && comparisonData && (
            <p className="mt-1 text-xs text-muted">
              {getDeltaLabel(
                data?.summary.avgTriageRound,
                comparisonData.summary.avgTriageRound
              )}
            </p>
          )}
        </Card>
        <Card>
          <p className="text-sm font-medium text-muted">AI health score</p>
          <p
            className={`mt-2 text-3xl font-bold tabular-nums ${
              recommendationResult?.healthScore == null
                ? "text-ink"
                : metricClass(recommendationResult.healthScore, true)
            }`}
          >
            {recommendationResult?.healthScore == null
              ? "—"
              : `${recommendationResult.healthScore}/100`}
          </p>
          <p className="mt-1 text-sm text-muted">
            Generated by recommendation analysis
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Playbook performance</h2>
            <p className="text-xs text-muted">
              Resolution and escalation behavior by playbook.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted">
              {loading ? "Loading..." : `${fmt(data?.playbookStats.length ?? 0)} playbooks`}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportPlaybookCsv}
              disabled={loading || sortedPlaybooks.length === 0}
            >
              Export CSV
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-page">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">
                  <button type="button" className="hover:underline" onClick={() => onSort("title")}>
                    Playbook
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" className="hover:underline" onClick={() => onSort("total")}>
                    Sessions
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onSort("resolutionRate")}
                  >
                    Resolution %
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onSort("escalationRate")}
                  >
                    Escalation %
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onSort("avgTurns")}
                  >
                    Avg turns
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onSort("frustrationRate")}
                  >
                    Frustration %
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onSort("verificationResponseRate")}
                  >
                    Verify response %
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-muted" colSpan={7}>
                    Loading analytics...
                  </td>
                </tr>
              ) : sortedPlaybooks.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-muted" colSpan={7}>
                    No playbook analytics data for this date range.
                  </td>
                </tr>
              ) : (
                sortedPlaybooks.map((row) => (
                  <tr key={row.playbookId} className="text-sm">
                    <td className="px-3 py-3">
                      <Link
                        href={`/admin/tickets?playbookId=${encodeURIComponent(row.playbookId)}&playbookLabel=${encodeURIComponent(row.title)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.title}
                      </Link>
                      <div className="text-xs text-muted">{row.labelName}</div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">{fmt(row.total)}</td>
                    <td className={`px-3 py-3 tabular-nums font-medium ${metricClass(row.resolutionRate, true)}`}>
                      {fmtPercent(row.resolutionRate)}
                      {comparisonByPlaybookId.has(row.playbookId) && (
                        <div
                          className={`mt-0.5 text-[11px] font-normal ${deltaClass(
                            row.resolutionRate,
                            comparisonByPlaybookId.get(row.playbookId)?.resolutionRate,
                            true
                          )}`}
                        >
                          {getDeltaLabel(
                            row.resolutionRate,
                            comparisonByPlaybookId.get(row.playbookId)?.resolutionRate,
                            "pp"
                          ) ?? "—"}
                        </div>
                      )}
                    </td>
                    <td className={`px-3 py-3 tabular-nums font-medium ${metricClass(row.escalationRate, false)}`}>
                      {fmtPercent(row.escalationRate)}
                      {comparisonByPlaybookId.has(row.playbookId) && (
                        <div
                          className={`mt-0.5 text-[11px] font-normal ${deltaClass(
                            row.escalationRate,
                            comparisonByPlaybookId.get(row.playbookId)?.escalationRate,
                            false
                          )}`}
                        >
                          {getDeltaLabel(
                            row.escalationRate,
                            comparisonByPlaybookId.get(row.playbookId)?.escalationRate,
                            "pp"
                          ) ?? "—"}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.avgTurns == null ? "—" : row.avgTurns}
                    </td>
                    <td className={`px-3 py-3 tabular-nums font-medium ${metricClass(row.frustrationRate, false)}`}>
                      {fmtPercent(row.frustrationRate)}
                      {comparisonByPlaybookId.has(row.playbookId) && (
                        <div
                          className={`mt-0.5 text-[11px] font-normal ${deltaClass(
                            row.frustrationRate,
                            comparisonByPlaybookId.get(row.playbookId)?.frustrationRate,
                            false
                          )}`}
                        >
                          {getDeltaLabel(
                            row.frustrationRate,
                            comparisonByPlaybookId.get(row.playbookId)?.frustrationRate,
                            "pp"
                          ) ?? "—"}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-3 py-3 tabular-nums font-medium ${metricClass(
                        row.verificationResponseRate,
                        true
                      )}`}
                    >
                      {fmtPercent(row.verificationResponseRate)}
                      {comparisonByPlaybookId.has(row.playbookId) && (
                        <div
                          className={`mt-0.5 text-[11px] font-normal ${deltaClass(
                            row.verificationResponseRate,
                            comparisonByPlaybookId.get(row.playbookId)?.verificationResponseRate,
                            true
                          )}`}
                        >
                          {getDeltaLabel(
                            row.verificationResponseRate ?? undefined,
                            comparisonByPlaybookId.get(row.playbookId)?.verificationResponseRate ??
                              undefined,
                            "pp"
                          ) ?? "—"}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Unmatched sessions by machine model
          </h2>
          {loading ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : (data?.coverageGaps.topUnmatchedMachineModels.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">No uncovered machine models in this range.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data?.coverageGaps.topUnmatchedMachineModels.map((item) => (
                <li key={item.label} className="flex items-center justify-between">
                  <Link
                    href={`/admin/tickets?machineModel=${encodeURIComponent(item.label)}&playbookId=none&playbookLabel=${encodeURIComponent("No matched playbook")}`}
                    className="text-primary hover:underline"
                  >
                    {item.label}
                  </Link>
                  <span className="font-medium tabular-nums text-muted">{fmt(item.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Unmatched sessions by product type
          </h2>
          {loading ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : (data?.coverageGaps.topUnmatchedProductTypes.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">No uncovered product types in this range.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data?.coverageGaps.topUnmatchedProductTypes.map((item) => (
                <li key={item.label} className="flex items-center justify-between">
                  <Link
                    href={`/admin/tickets?productType=${encodeURIComponent(item.label)}&playbookId=none&playbookLabel=${encodeURIComponent("No matched playbook")}`}
                    className="text-primary hover:underline"
                  >
                    {item.label}
                  </Link>
                  <span className="font-medium tabular-nums text-muted">{fmt(item.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Generate AI recommendations</h2>
            <p className="text-xs text-muted">
              Use aggregated analytics to suggest playbook and workflow optimizations.
            </p>
          </div>
          <Button
            onClick={runRecommendationAnalysis}
            disabled={loading || !data || recommendationLoading}
          >
            {recommendationLoading ? "Analyzing..." : "Run analysis"}
          </Button>
        </div>
        {recommendationError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
            {recommendationError}
          </p>
        )}
      </Card>

      {recommendationHistory.length > 0 && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Recent analysis runs</h2>
            <div className="flex items-center gap-3">
              {historySparkline && (
                <div className="flex items-center gap-1">
                  <svg
                    width={historySparkline.width}
                    height={historySparkline.height}
                    viewBox={`0 0 ${historySparkline.width} ${historySparkline.height}`}
                    aria-hidden
                  >
                    <polyline
                      points={historySparkline.coordinates}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-primary"
                    />
                  </svg>
                  <span className="text-xs text-muted">Health trend</span>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={clearRecommendationHistory}>
                Clear history
              </Button>
            </div>
          </div>
          <ul className="space-y-2 text-sm">
            {recommendationHistory.map((item, idx) => (
              <li key={`${item.createdAt}-${idx}`} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-ink">
                    {formatDateTimeAu(item.createdAt)} - {item.recommendationCount} recommendations
                  </p>
                  <p className="text-xs text-muted line-clamp-2">{item.summary}</p>
                </div>
                <span className={`text-sm font-medium ${metricClass(item.healthScore, true)}`}>
                  {item.healthScore == null ? "—" : `${item.healthScore}/100`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {recommendationResult && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-ink">Executive summary</h2>
            <p className="text-sm text-ink">{recommendationResult.summary}</p>
            {recommendationResult.rawText && (
              <p className="mt-2 text-xs text-muted">
                Model returned fallback text due to schema mismatch.
              </p>
            )}
          </Card>

          {(["high", "medium", "low"] as const).map((priority) => (
            <div key={priority} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {priority} priority
              </h3>
              {recommendationsByPriority[priority].length === 0 ? (
                <p className="text-sm text-muted">No items.</p>
              ) : (
                recommendationsByPriority[priority].map((item, idx) => (
                  <Card key={`${priority}-${idx}`} className={`border ${priorityClass(priority)}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-ink">{item.title}</p>
                        <p className="text-xs text-muted mt-1">
                          {item.type.replaceAll("_", " ")}
                        </p>
                      </div>
                      {item.playbookId && (
                        <Link
                          href={`/admin/playbooks/${item.playbookId}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Edit playbook
                        </Link>
                      )}
                    </div>
                    <p className="mt-3 text-sm text-ink">
                      <span className="font-medium">Insight:</span> {item.insight}
                    </p>
                    <p className="mt-2 text-sm text-ink">
                      <span className="font-medium">Action:</span> {item.action}
                    </p>
                    <p className="mt-2 text-sm text-ink">
                      <span className="font-medium">Impact:</span> {item.impact}
                    </p>
                    {item.playbookTitle && (
                      <p className="mt-2 text-xs text-muted">Target: {item.playbookTitle}</p>
                    )}
                  </Card>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
