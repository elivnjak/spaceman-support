"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  if (level === "error") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (level === "warn") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
}

function levelCardClasses(level: ErrorLogLevel): string {
  if (level === "error") return "border-red-300 dark:border-red-700";
  if (level === "warn") return "border-amber-300 dark:border-amber-700";
  return "border-blue-300 dark:border-blue-700";
}

function truncate(value: string, max = 22): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export default function AdminErrorLogsPage() {
  const [retentionDays, setRetentionDays] = useState(30);
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);
  const [summary, setSummary] = useState<ErrorLogSessionSummary[]>([]);
  const [query, setQuery] = useState("");
  const [sessionIdFilter, setSessionIdFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | ErrorLogLevel>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Error logs</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          File logs stored in <code>/logs</code>. Entries older than {retentionDays} days are
          automatically deleted.
        </p>
      </header>

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search message, stack, route..."
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <input
          type="text"
          value={sessionIdFilter}
          onChange={(e) => setSessionIdFilter(e.target.value)}
          placeholder="Filter by session ID..."
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <div className="flex gap-2">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as "" | ErrorLogLevel)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          >
            <option value="">All levels</option>
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info">Info</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSessionIdFilter("");
              setLevelFilter("");
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Clear
          </button>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-500 dark:text-gray-400">Visible logs</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">{totalCount}</p>
        </div>
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-900/20">
          <p className="text-red-700 dark:text-red-300">Errors</p>
          <p className="text-xl font-semibold text-red-800 dark:text-red-200">{levelCounts.error}</p>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <p className="text-amber-700 dark:text-amber-300">Warnings</p>
          <p className="text-xl font-semibold text-amber-800 dark:text-amber-200">{levelCounts.warn}</p>
        </div>
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/20">
          <p className="text-blue-700 dark:text-blue-300">Info</p>
          <p className="text-xl font-semibold text-blue-800 dark:text-blue-200">{levelCounts.info}</p>
        </div>
      </section>

      <section className="mb-6 overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
          Session summary
        </div>
        {loading ? (
          <p className="p-4 text-sm text-gray-600 dark:text-gray-300">Loading error logs...</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : summary.length === 0 ? (
          <p className="p-4 text-sm text-gray-600 dark:text-gray-300">No matching sessions.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Logs</th>
                <th className="px-4 py-3">Errors</th>
                <th className="px-4 py-3">Warnings</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3">Last message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {summary.map((row) => (
                <tr key={row.sessionId ?? "__no_session__"} className="text-sm">
                  <td className="px-4 py-3">
                    {row.sessionId ? (
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-gray-900 dark:text-white" title={row.sessionId}>
                          {truncate(row.sessionId, 24)}
                        </span>
                        <Link
                          href={`/admin/audit-logs/${row.sessionId}`}
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Open audit session
                        </Link>
                      </div>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">No session ID</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.logCount}</td>
                  <td className="px-4 py-3 text-red-700 dark:text-red-300">{row.errorCount}</td>
                  <td className="px-4 py-3 text-amber-700 dark:text-amber-300">{row.warnCount}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{formatDate(row.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300" title={row.lastMessage}>
                    {truncate(row.lastMessage, 70)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Log entries</h2>
        {loading ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            Loading entries...
          </p>
        ) : error ? (
          <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            No matching log entries.
          </p>
        ) : (
          entries.map((entry) => (
            <article
              key={entry.id}
              className={`rounded-lg border bg-white p-4 dark:bg-gray-800 ${levelCardClasses(entry.level)}`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${levelBadgeClasses(entry.level)}`}
                >
                  {entry.level}
                </span>
                <span className="text-gray-600 dark:text-gray-300">{formatDate(entry.timestamp)}</span>
                {entry.route ? (
                  <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    {entry.route}
                  </code>
                ) : null}
                {entry.sessionId ? (
                  <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                    session: {entry.sessionId}
                  </code>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">session: -</span>
                )}
              </div>

              <pre className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                {entry.message}
              </pre>

              {entry.errorName ? (
                <p className="mt-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                  Error type: <code>{entry.errorName}</code>
                </p>
              ) : null}

              {entry.stack ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-red-700 dark:text-red-300">
                    Stack trace
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
                    {entry.stack}
                  </pre>
                </details>
              ) : null}

              {entry.context ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Context
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border border-gray-300 bg-gray-100 p-3 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                    {prettyJson(entry.context)}
                  </pre>
                </details>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
