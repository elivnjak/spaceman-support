"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AuditSessionSummary = {
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

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function truncate(value: string, max = 14): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export default function AdminAuditLogsPage() {
  const [rows, setRows] = useState<AuditSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/admin/audit-logs")
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load audit logs.");
        return r.json();
      })
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load audit logs."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.sessionId, row.machineModel, row.serialNumber, row.productType, row.phase, row.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [query, rows]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit logs</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Browse sessions with stored diagnostic audit data.
        </p>
      </header>

      <div className="mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by session ID, model, serial, status..."
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {loading ? (
          <p className="p-6 text-sm text-gray-600 dark:text-gray-300">Loading audit logs...</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-600 dark:text-gray-300">No audit logs found.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Turns</th>
                <th className="px-4 py-3">Audit entries</th>
                <th className="px-4 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((row) => (
                <tr key={row.sessionId} className="text-sm">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/audit-logs/${row.sessionId}`}
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                      title={row.sessionId}
                    >
                      {truncate(row.sessionId, 18)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.machineModel ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.status ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.phase ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.turnCount ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.logCount}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{formatDate(row.lastLogAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
