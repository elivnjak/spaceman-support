"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type ErrorLogLevel = "error" | "warn" | "info";

type ErrorLogEntry = {
  id: string;
  timestamp: string;
  level: ErrorLogLevel;
  message: string;
  sessionId: string | null;
  route?: string;
  errorName?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

type ErrorLogSessionSummary = {
  sessionId: string | null;
  logCount: number;
  errorCount: number;
  warnCount: number;
  infoCount: number;
  lastSeenAt: string;
  lastMessage: string;
};

type ErrorLogsResponse = {
  retentionDays: number;
  logPath?: string;
  entries: ErrorLogEntry[];
  summary: ErrorLogSessionSummary[];
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function levelBadgeClasses(level: ErrorLogLevel): string {
  if (level === "error") return "bg-red-100 text-red-800";
  if (level === "warn") return "bg-amber-100 text-amber-800";
  return "bg-blue-100 text-blue-800";
}

function levelCardClasses(level: ErrorLogLevel): string {
  if (level === "error") return "border-red-300";
  if (level === "warn") return "border-amber-300";
  return "border-blue-300";
}

function truncate(value: string, max = 22): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export default function AdminErrorLogsPage() {
  const [retentionDays, setRetentionDays] = useState(30);
  const [logPath, setLogPath] = useState<string>("/logs");
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);
  const [summary, setSummary] = useState<ErrorLogSessionSummary[]>([]);
  const [query, setQuery] = useState("");
  const [sessionIdFilter, setSessionIdFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | ErrorLogLevel>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryPage, setSummaryPage] = useState(1);
  const [summaryPageSize, setSummaryPageSize] = useState(10);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesPageSize, setEntriesPageSize] = useState(20);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (sessionIdFilter.trim()) params.set("sessionId", sessionIdFilter.trim());
      if (levelFilter) params.set("level", levelFilter);
      params.set("limit", "5000");

      fetch(`/api/admin/error-logs?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load error logs.");
          return (await res.json()) as ErrorLogsResponse;
        })
        .then((payload) => {
          setRetentionDays(payload.retentionDays ?? 30);
          setLogPath(payload.logPath?.trim() || "/logs");
          setEntries(Array.isArray(payload.entries) ? payload.entries : []);
          setSummary(Array.isArray(payload.summary) ? payload.summary : []);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Failed to load error logs.");
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [levelFilter, query, sessionIdFilter]);

  useEffect(() => {
    setSummaryPage(1);
    setEntriesPage(1);
  }, [query, sessionIdFilter, levelFilter, summaryPageSize, entriesPageSize]);

  const totalCount = entries.length;
  const levelCounts = useMemo(() => {
    return entries.reduce(
      (acc, entry) => {
        acc[entry.level] += 1;
        return acc;
      },
      { error: 0, warn: 0, info: 0 }
    );
  }, [entries]);

  const summaryTotalPages = Math.max(1, Math.ceil(summary.length / summaryPageSize));
  const safeSummaryPage = Math.min(summaryPage, summaryTotalPages);
  const paginatedSummary = useMemo(
    () =>
      summary.slice(
        (safeSummaryPage - 1) * summaryPageSize,
        safeSummaryPage * summaryPageSize
      ),
    [summary, safeSummaryPage, summaryPageSize]
  );

  const entriesTotalPages = Math.max(1, Math.ceil(entries.length / entriesPageSize));
  const safeEntriesPage = Math.min(entriesPage, entriesTotalPages);
  const paginatedEntries = useMemo(
    () =>
      entries.slice(
        (safeEntriesPage - 1) * entriesPageSize,
        safeEntriesPage * entriesPageSize
      ),
    [entries, safeEntriesPage, entriesPageSize]
  );

  useEffect(() => {
    if (summaryPage !== safeSummaryPage) setSummaryPage(safeSummaryPage);
  }, [summaryPage, safeSummaryPage]);

  useEffect(() => {
    if (entriesPage !== safeEntriesPage) setEntriesPage(safeEntriesPage);
  }, [entriesPage, safeEntriesPage]);

  return (
    <div>
      <PageHeader
        title="Error logs"
        description={`File logs stored in ${logPath}. Entries older than ${retentionDays} days are automatically deleted.`}
      />

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search message, stack, route..."
        />
        <Input
          type="text"
          value={sessionIdFilter}
          onChange={(e) => setSessionIdFilter(e.target.value)}
          placeholder="Filter by session ID..."
        />
        <div className="flex gap-2">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as "" | ErrorLogLevel)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
          >
            <option value="">All levels</option>
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info">Info</option>
          </select>
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setSessionIdFilter("");
              setLevelFilter("");
            }}
          >
            Clear
          </Button>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Card padding="sm">
          <p className="text-muted">Visible logs</p>
          <p className="text-xl font-semibold text-ink">{totalCount}</p>
        </Card>
        <div className="rounded-card border border-red-300 bg-red-50 p-3">
          <p className="text-red-700">Errors</p>
          <p className="text-xl font-semibold text-red-800">{levelCounts.error}</p>
        </div>
        <div className="rounded-card border border-amber-300 bg-amber-50 p-3">
          <p className="text-amber-700">Warnings</p>
          <p className="text-xl font-semibold text-amber-800">{levelCounts.warn}</p>
        </div>
        <div className="rounded-card border border-blue-300 bg-blue-50 p-3">
          <p className="text-blue-700">Info</p>
          <p className="text-xl font-semibold text-blue-800">{levelCounts.info}</p>
        </div>
      </section>

      <section className="mb-6 overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
          Session summary
        </div>
        {loading ? (
          <p className="p-4 text-sm text-muted">Loading error logs...</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : summary.length === 0 ? (
          <p className="p-4 text-sm text-muted">No matching sessions.</p>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-page">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Logs</th>
                <th className="px-4 py-3">Errors</th>
                <th className="px-4 py-3">Warnings</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3">Last message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedSummary.map((row) => (
                <tr key={row.sessionId ?? "__no_session__"} className="text-sm">
                  <td className="px-4 py-3">
                    {row.sessionId ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-ink" title={row.sessionId}>
                          {truncate(row.sessionId, 24)}
                        </span>
                        <Link
                          href={`/admin/audit-logs/${row.sessionId}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Open audit session
                        </Link>
                      </div>
                    ) : (
                      <span className="text-muted">No session ID</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.logCount}</td>
                  <td className="px-4 py-3 text-red-700">{row.errorCount}</td>
                  <td className="px-4 py-3 text-amber-700">{row.warnCount}</td>
                  <td className="px-4 py-3 text-muted">{formatDate(row.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-muted" title={row.lastMessage}>
                    {truncate(row.lastMessage, 70)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {!loading && !error && summary.length > 0 && (
        <div className="mb-6 flex flex-col items-center gap-2">
          {summaryTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSummaryPage(1)}
                disabled={safeSummaryPage <= 1}
                aria-label="First summary page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setSummaryPage((prev) => Math.max(1, prev - 1))}
                disabled={safeSummaryPage <= 1}
                aria-label="Previous summary page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ‹
              </button>
              {(() => {
                const pages: (number | "...")[] = [];
                const total = summaryTotalPages;
                const current = safeSummaryPage;
                if (total <= 7) {
                  for (let i = 1; i <= total; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (current > 3) pages.push("...");
                  const start = Math.max(2, current - 1);
                  const end = Math.min(total - 1, current + 1);
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (current < total - 2) pages.push("...");
                  pages.push(total);
                }
                return pages.map((p, idx) =>
                  p === "..." ? (
                    <span
                      key={`summary-ellipsis-${idx}`}
                      className="flex h-8 w-8 items-center justify-center text-sm text-muted"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSummaryPage(p as number)}
                      aria-label={`Summary page ${p}`}
                      aria-current={p === current ? "page" : undefined}
                      className={`flex h-8 min-w-[2rem] items-center justify-center rounded-md border px-2 text-sm transition-colors ${
                        p === current
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface text-ink hover:bg-page"
                      }`}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
              <button
                type="button"
                onClick={() => setSummaryPage((prev) => Math.min(summaryTotalPages, prev + 1))}
                disabled={safeSummaryPage >= summaryTotalPages}
                aria-label="Next summary page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setSummaryPage(summaryTotalPages)}
                disabled={safeSummaryPage >= summaryTotalPages}
                aria-label="Last summary page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                »
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted">
            <span>
              Showing {(safeSummaryPage - 1) * summaryPageSize + 1}–
              {Math.min(safeSummaryPage * summaryPageSize, summary.length)} of {summary.length} sessions
            </span>
            <select
              value={String(summaryPageSize)}
              onChange={(e) => setSummaryPageSize(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
              aria-label="Summary rows per page"
            >
              <option value="10">10 / page</option>
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Log entries</h2>
          {!loading && !error && entries.length > 0 && (
            <select
              value={String(entriesPageSize)}
              onChange={(e) => setEntriesPageSize(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              aria-label="Log entries per page"
            >
              <option value="10">10 / page</option>
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
          )}
        </div>
        {loading ? (
          <Card>
            <p className="text-sm text-muted">Loading entries...</p>
          </Card>
        ) : error ? (
          <div className="rounded-card border border-red-300 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No matching log entries.</p>
          </Card>
        ) : (
          paginatedEntries.map((entry) => (
            <article
              key={entry.id}
              className={`rounded-card border bg-surface p-4 ${levelCardClasses(entry.level)}`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${levelBadgeClasses(entry.level)}`}
                >
                  {entry.level}
                </span>
                <span className="text-muted">{formatDate(entry.timestamp)}</span>
                {entry.route ? (
                  <code className="rounded bg-page px-2 py-0.5 text-xs text-muted">
                    {entry.route}
                  </code>
                ) : null}
                {entry.sessionId ? (
                  <code className="rounded bg-page px-2 py-0.5 text-xs text-muted">
                    session: {entry.sessionId}
                  </code>
                ) : (
                  <span className="text-xs text-muted">session: -</span>
                )}
              </div>

              <pre className="whitespace-pre-wrap rounded border border-border bg-page p-3 text-xs text-ink">
                {entry.message}
              </pre>

              {entry.errorName ? (
                <p className="mt-2 text-xs font-medium text-muted">
                  Error type: <code>{entry.errorName}</code>
                </p>
              ) : null}

              {entry.stack ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-red-700">
                    Stack trace
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900">
                    {entry.stack}
                  </pre>
                </details>
              ) : null}

              {entry.context ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">
                    Context
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border border-border bg-page p-3 text-xs text-ink">
                    {prettyJson(entry.context)}
                  </pre>
                </details>
              ) : null}
            </article>
          ))
        )}
      </section>

      {!loading && !error && entries.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {entriesTotalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEntriesPage(1)}
                disabled={safeEntriesPage <= 1}
                aria-label="First log page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setEntriesPage((prev) => Math.max(1, prev - 1))}
                disabled={safeEntriesPage <= 1}
                aria-label="Previous log page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ‹
              </button>
              {(() => {
                const pages: (number | "...")[] = [];
                const total = entriesTotalPages;
                const current = safeEntriesPage;
                if (total <= 7) {
                  for (let i = 1; i <= total; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (current > 3) pages.push("...");
                  const start = Math.max(2, current - 1);
                  const end = Math.min(total - 1, current + 1);
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (current < total - 2) pages.push("...");
                  pages.push(total);
                }
                return pages.map((p, idx) =>
                  p === "..." ? (
                    <span
                      key={`entry-ellipsis-${idx}`}
                      className="flex h-8 w-8 items-center justify-center text-sm text-muted"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setEntriesPage(p as number)}
                      aria-label={`Log page ${p}`}
                      aria-current={p === current ? "page" : undefined}
                      className={`flex h-8 min-w-[2rem] items-center justify-center rounded-md border px-2 text-sm transition-colors ${
                        p === current
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface text-ink hover:bg-page"
                      }`}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
              <button
                type="button"
                onClick={() => setEntriesPage((prev) => Math.min(entriesTotalPages, prev + 1))}
                disabled={safeEntriesPage >= entriesTotalPages}
                aria-label="Next log page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setEntriesPage(entriesTotalPages)}
                disabled={safeEntriesPage >= entriesTotalPages}
                aria-label="Last log page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                »
              </button>
            </div>
          )}
          <p className="text-sm text-muted">
            Showing {(safeEntriesPage - 1) * entriesPageSize + 1}–
            {Math.min(safeEntriesPage * entriesPageSize, entries.length)} of {entries.length} entries
          </p>
        </div>
      )}
    </div>
  );
}
