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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
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

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((row) => selectedSessionIds.has(row.sessionId));
  const selectedCount = selectedSessionIds.size;

  function toggleSelectOne(sessionId: string): void {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }

  function toggleSelectAllFiltered(): void {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((row) => next.delete(row.sessionId));
      } else {
        filtered.forEach((row) => next.add(row.sessionId));
      }
      return next;
    });
  }

  async function handleDelete(sessionId: string): Promise<void> {
    if (
      !confirm(
        "Delete this audit session and all associated uploaded files? This cannot be undone."
      )
    ) {
      return;
    }

    setDeleteError(null);
    setDeletingSessionId(sessionId);
    try {
      const response = await fetch(`/api/admin/audit-logs/${sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to delete audit session.");
      }
      setRows((prev) => prev.filter((row) => row.sessionId !== sessionId));
      setSelectedSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete audit session.");
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleBulkDelete(): Promise<void> {
    if (selectedSessionIds.size === 0 || bulkDeleting) return;
    if (
      !confirm(
        `Delete ${selectedSessionIds.size} audit session(s) and all associated uploaded files? This cannot be undone.`
      )
    ) {
      return;
    }

    const ids = Array.from(selectedSessionIds);
    setDeleteError(null);
    setBulkDeleting(true);
    try {
      const response = await fetch("/api/admin/audit-logs/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: ids }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to bulk delete audit sessions.");
      }
      const deletedSet = new Set(ids);
      setRows((prev) => prev.filter((row) => !deletedSet.has(row.sessionId)));
      setSelectedSessionIds(new Set());
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to bulk delete audit sessions.");
    } finally {
      setBulkDeleting(false);
    }
  }

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
      {selectedCount > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={bulkDeleting || Boolean(deletingSessionId)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            {bulkDeleting ? "Deleting..." : `Delete selected (${selectedCount})`}
          </button>
          <button
            type="button"
            onClick={() => setSelectedSessionIds(new Set())}
            disabled={bulkDeleting}
            className="text-sm text-gray-600 hover:underline disabled:opacity-60 dark:text-gray-300"
          >
            Clear selection
          </button>
        </div>
      )}
      {deleteError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{deleteError}</p>}

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
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    disabled={filtered.length === 0 || bulkDeleting}
                    aria-label="Select all filtered audit sessions"
                  />
                </th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Turns</th>
                <th className="px-4 py-3">Audit entries</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((row) => (
                <tr key={row.sessionId} className="text-sm">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.has(row.sessionId)}
                      onChange={() => toggleSelectOne(row.sessionId)}
                      disabled={bulkDeleting}
                      aria-label={`Select session ${row.sessionId}`}
                    />
                  </td>
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
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(row.sessionId)}
                      disabled={bulkDeleting || deletingSessionId === row.sessionId}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                    >
                      {deletingSessionId === row.sessionId ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
