"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatDateTimeAu } from "@/lib/date-format";

type AuditSessionSummary = {
  sessionId: string;
  logCount: number;
  lastLogAt: string | null;
  userName: string | null;
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
  return formatDateTimeAu(value);
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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
    return rows.filter((row) => {
      if (statusFilter !== "all" && (row.status ?? "") !== statusFilter) return false;
      if (phaseFilter !== "all" && (row.phase ?? "") !== phaseFilter) return false;
      if (!q) return true;
      return [
        row.sessionId,
        row.userName,
        row.machineModel,
        row.serialNumber,
        row.productType,
        row.phase,
        row.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [phaseFilter, query, rows, statusFilter]);

  const statusOptions = useMemo(() => {
    const unique = new Set(
      rows
        .map((row) => row.status)
        .filter((value): value is string => Boolean(value))
    );
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const phaseOptions = useMemo(() => {
    const unique = new Set(
      rows
        .map((row) => row.phase)
        .filter((value): value is string => Boolean(value))
    );
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, phaseFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, pageSize, safePage]
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const allFilteredSelected =
    paginatedRows.length > 0 &&
    paginatedRows.every((row) => selectedSessionIds.has(row.sessionId));
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
        paginatedRows.forEach((row) => next.delete(row.sessionId));
      } else {
        paginatedRows.forEach((row) => next.add(row.sessionId));
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
      <PageHeader
        title="Audit logs"
        description="Browse sessions with stored diagnostic audit data."
      />

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by session, user, model, serial, status..."
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
          >
            <option value="all">All phases</option>
            {phaseOptions.map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setPhaseFilter("all");
            }}
            disabled={!query && statusFilter === "all" && phaseFilter === "all"}
          >
            Clear
          </Button>
        </div>
      </section>
      {!loading && filtered.length > 0 && (
        <div className="mb-4 text-right text-sm text-muted">
          {(() => {
            const from = (safePage - 1) * pageSize + 1;
            const to = Math.min(safePage * pageSize, filtered.length);
            return `Showing ${from}–${to} of ${filtered.length} session${filtered.length === 1 ? "" : "s"}`;
          })()}
        </div>
      )}
      {selectedCount > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <Button
            variant="danger"
            size="sm"
            onClick={handleBulkDelete}
            disabled={bulkDeleting || Boolean(deletingSessionId)}
          >
            {bulkDeleting ? "Deleting..." : `Delete selected (${selectedCount})`}
          </Button>
          <button
            type="button"
            onClick={() => setSelectedSessionIds(new Set())}
            disabled={bulkDeleting}
            className="text-sm text-muted hover:underline disabled:opacity-60"
          >
            Clear selection
          </button>
        </div>
      )}
      {deleteError && <p className="mb-4 text-sm text-red-600">{deleteError}</p>}

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        {loading ? (
          <p className="p-6 text-sm text-muted">Loading audit logs...</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted">No audit logs found.</p>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-page">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    disabled={paginatedRows.length === 0 || bulkDeleting}
                    aria-label="Select all visible audit sessions"
                  />
                </th>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Turns</th>
                <th className="px-4 py-3">Audit entries</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedRows.map((row) => (
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
                      className="font-medium text-primary hover:underline"
                      title={row.sessionId}
                    >
                      {truncate(row.sessionId, 18)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{row.userName ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{row.machineModel ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{row.status ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{row.phase ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{row.turnCount ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{row.logCount}</td>
                  <td className="px-4 py-3 text-muted">{formatDate(row.lastLogAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(row.sessionId)}
                      disabled={bulkDeleting || deletingSessionId === row.sessionId}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-60"
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

      {!loading && filtered.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={safePage <= 1}
                aria-label="First page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={safePage <= 1}
                aria-label="Previous page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ‹
              </button>
              {(() => {
                const pages: (number | "...")[] = [];
                const total = totalPages;
                const current = safePage;

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
                      key={`ellipsis-${idx}`}
                      className="flex h-8 w-8 items-center justify-center text-sm text-muted"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p as number)}
                      aria-label={`Page ${p}`}
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
                onClick={() => setPage((prev) => prev + 1)}
                disabled={safePage >= totalPages}
                aria-label="Next page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={safePage >= totalPages}
                aria-label="Last page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                »
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="audit-page-size" className="text-sm text-muted">
              Rows per page
            </label>
            <select
              id="audit-page-size"
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
