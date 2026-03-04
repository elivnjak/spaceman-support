"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";

// ── Types ──────────────────────────────────────────────────────────────────

type AnalyticsSummary = {
  total: number;
  resolved: number;
  escalated: number;
  active: number;
  resolutionRate: number;
  escalationRate: number;
  avgTurnCount: number;
  frustrationCount: number;
  frustrationRate: number;
};

type ResolutionOutcomes = {
  confirmed: number;
  notFixed: number;
  partiallyFixed: number;
  noResponse: number;
};

type EscalationItem = { label: string; count: number };

type DailyPoint = {
  date: string;
  total: number;
  resolved: number;
  escalated: number;
  active: number;
};

type AnalyticsData = {
  summary: AnalyticsSummary;
  resolutionOutcomes: ResolutionOutcomes;
  escalationBreakdown: EscalationItem[];
  dailySeries: DailyPoint[];
};

// ── Date range presets ─────────────────────────────────────────────────────

type Preset = "today" | "7d" | "30d" | "90d" | "all" | "custom";

const PRESET_BUTTONS: Array<{ id: Preset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "all", label: "All time" },
];

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const toStr = now.toISOString().split("T")[0];
  if (preset === "today") {
    return { from: toStr, to: toStr };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().split("T")[0], to: toStr };
}

// ── Chart colours ──────────────────────────────────────────────────────────

const COLOURS = {
  resolved: "#22c55e",
  escalated: "#ef4444",
  active: "#f59e0b",
  total: "#6366f1",
  frustration: "#f97316",
  requestedHuman: "#8b5cf6",
  other: "#94a3b8",
};

const OUTCOME_COLOURS: Record<string, string> = {
  Confirmed: "#22c55e",
  "Not fixed": "#ef4444",
  "Partially fixed": "#f59e0b",
  "No response": "#94a3b8",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "red" | "amber" | "orange";
}) {
  const accentClass =
    accent === "green"
      ? "text-green-600 dark:text-green-400"
      : accent === "red"
      ? "text-red-600 dark:text-red-400"
      : accent === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : accent === "orange"
      ? "text-orange-500 dark:text-orange-400"
      : "text-ink";

  return (
    <Card>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </Card>
  );
}

// ── Custom tooltip for recharts ────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium text-ink">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: <span className="font-semibold tabular-nums">{fmt(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function AdminDashboardClient() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    if (preset === "all") return { from: "", to: "" };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    fetch(`/api/admin/analytics?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          setSessionExpired(true);
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to load analytics.");
        }
        return res.json() as Promise<AnalyticsData>;
      })
      .then((payload) => {
        if (payload) setData(payload);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load analytics.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [from, to]);

  const s = data?.summary;

  const outcomeChartData = data
    ? [
        { name: "Confirmed", value: data.resolutionOutcomes.confirmed },
        { name: "Not fixed", value: data.resolutionOutcomes.notFixed },
        { name: "Partially fixed", value: data.resolutionOutcomes.partiallyFixed },
        { name: "No response", value: data.resolutionOutcomes.noResponse },
      ].filter((item) => item.value > 0)
    : [];

  const frustrationEsc = data?.escalationBreakdown.find((e) => e.label === "Frustration")?.count ?? 0;

  if (sessionExpired) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-8 text-center dark:border-amber-900/40 dark:bg-amber-900/20">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          Your session has expired or is no longer valid.
        </p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
          Please sign out and sign back in to continue.
        </p>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            window.location.href = "/admin";
          }}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Sign out and sign in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Date range toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PRESET_BUTTONS.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => {
                setPreset(btn.id);
              }}
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

      {/* ── Error / loading ── */}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {/* ── Stat cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total sessions"
          value={loading ? "—" : fmt(s?.total ?? 0)}
          sub={s && s.avgTurnCount > 0 ? `Avg ${s.avgTurnCount} turns per session` : undefined}
        />
        <StatCard
          label="Resolved by AI"
          value={loading ? "—" : fmt(s?.resolved ?? 0)}
          sub={s ? `${s.resolutionRate}% of sessions` : undefined}
          accent="green"
        />
        <StatCard
          label="Escalated"
          value={loading ? "—" : fmt(s?.escalated ?? 0)}
          sub={s ? `${s.escalationRate}% of sessions` : undefined}
          accent="red"
        />
        <StatCard
          label="Active sessions"
          value={loading ? "—" : fmt(s?.active ?? 0)}
          sub={s && s.total > 0 ? `${Math.round((s.active / s.total) * 1000) / 10}% of sessions` : undefined}
          accent="amber"
        />
        <StatCard
          label="AI resolution rate"
          value={loading ? "—" : `${s?.resolutionRate ?? 0}%`}
          sub="Sessions resolved without escalation"
          accent="green"
        />
        <StatCard
          label="Frustrated users"
          value={loading ? "—" : fmt(s?.frustrationCount ?? 0)}
          sub={s ? `${s.frustrationRate}% of sessions` : undefined}
          accent="orange"
        />
      </div>

      {/* ── Charts row ── */}
      {!loading && data && (
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Daily sessions bar chart */}
          <Card className="lg:col-span-3">
            <h2 className="mb-4 text-sm font-semibold text-ink">Sessions over time</h2>
            {data.dailySeries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={data.dailySeries}
                  margin={{ top: 4, right: 4, left: -20, bottom: 4 }}
                  barSize={data.dailySeries.length > 30 ? 4 : 8}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e2e8f0)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 11, fill: "var(--color-muted, #94a3b8)" }}
                    interval="preserveStartEnd"
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-muted, #94a3b8)" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="resolved" name="Resolved" stackId="a" fill={COLOURS.resolved} />
                  <Bar dataKey="escalated" name="Escalated" stackId="a" fill={COLOURS.escalated} />
                  <Bar dataKey="active" name="Active" stackId="a" fill={COLOURS.active} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOURS.resolved }} />Resolved</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOURS.escalated }} />Escalated</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOURS.active }} />Active</span>
            </div>
          </Card>

          {/* Resolution outcomes donut */}
          <Card className="lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold text-ink">Resolution outcomes</h2>
            {outcomeChartData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No resolved sessions yet.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={outcomeChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {outcomeChartData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={OUTCOME_COLOURS[entry.name] ?? COLOURS.other}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number | undefined, name: string | undefined) => [fmt(value ?? 0), name ?? ""]}
                      contentStyle={{
                        borderRadius: "0.5rem",
                        border: "1px solid var(--color-border, #e2e8f0)",
                        background: "var(--color-surface, #fff)",
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-1 space-y-1 text-xs text-muted">
                  {outcomeChartData.map((entry) => (
                    <li key={entry.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: OUTCOME_COLOURS[entry.name] ?? COLOURS.other }}
                        />
                        {entry.name}
                      </span>
                      <span className="tabular-nums font-medium text-ink">{fmt(entry.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ── Escalation breakdown ── */}
      {!loading && data && data.escalationBreakdown.length > 0 && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-ink">Escalation reasons</h2>
          <p className="mb-4 text-xs text-muted">
            Breakdown of why sessions were escalated to a human agent.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={data.escalationBreakdown}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
              barSize={18}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border, #e2e8f0)" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "var(--color-muted, #94a3b8)" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={{ fontSize: 12, fill: "var(--color-ink, #1e293b)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number | undefined) => [fmt(value ?? 0), "Sessions"]}
                contentStyle={{
                  borderRadius: "0.5rem",
                  border: "1px solid var(--color-border, #e2e8f0)",
                  background: "var(--color-surface, #fff)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" name="Sessions" fill={COLOURS.escalated} radius={[0, 3, 3, 0]}>
                {data.escalationBreakdown.map((entry) => (
                  <Cell
                    key={entry.label}
                    fill={
                      entry.label === "Frustration"
                        ? COLOURS.frustration
                        : entry.label === "Requested human"
                        ? COLOURS.requestedHuman
                        : COLOURS.escalated
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Callout stat */}
          {s && s.escalated > 0 && (
            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm dark:border-orange-900/40 dark:bg-orange-900/20">
              <span className="font-semibold text-orange-700 dark:text-orange-400">
                {fmt(frustrationEsc)} of {fmt(s.escalated)} escalations
              </span>
              <span className="text-orange-700 dark:text-orange-400">
                {" "}were frustration-driven (
                {s.escalated > 0
                  ? Math.round((frustrationEsc / s.escalated) * 1000) / 10
                  : 0}
                %)
              </span>
            </div>
          )}
        </Card>
      )}

      {/* ── Empty state when no sessions yet ── */}
      {!loading && !error && data && data.summary.total === 0 && (
        <Card>
          <p className="py-6 text-center text-sm text-muted">
            No support sessions found for this date range.
          </p>
        </Card>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <div className="h-4 w-24 animate-pulse rounded bg-border" />
              <div className="mt-3 h-8 w-16 animate-pulse rounded bg-border" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
