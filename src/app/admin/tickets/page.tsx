"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type TicketStatus = "open" | "in_progress" | "waiting" | "closed";
type SessionStatus = "active" | "resolved" | "escalated";

type TicketListItem = {
  id: string;
  status: string | null;
  ticketStatus: string | null;
  phase: string | null;
  turnCount: number | null;
  userName: string | null;
  userPhone: string | null;
  machineModel: string | null;
  serialNumber: string | null;
  productType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type TicketListResponse = {
  items: TicketListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZE = 20;
const TICKET_STATUS_OPTIONS: Array<{ value: "all" | TicketStatus; label: string }> = [
  { value: "all", label: "All ticket statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "closed", label: "Closed" },
];
const SESSION_STATUS_OPTIONS: Array<{ value: "all" | SessionStatus; label: string }> = [
  { value: "all", label: "All session statuses" },
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "escalated", label: "Escalated" },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString(undefined, { hour12: true });
}

function truncate(value: string, max = 16): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function ticketStatusLabel(status: string | null): string {
  if (status === "in_progress") return "In progress";
  if (status === "waiting") return "Waiting";
  if (status === "closed") return "Closed";
  return "Open";
}

function ticketStatusBadgeVariant(status: string | null): "warning" | "danger" | "success" | "info" {
  if (status === "in_progress") return "warning";
  if (status === "waiting") return "danger";
  if (status === "closed") return "success";
  return "info";
}

export default function AdminTicketsPage() {
  const [query, setQuery] = useState("");
  const [ticketStatus, setTicketStatus] = useState<"all" | TicketStatus>("all");
  const [sessionStatus, setSessionStatus] = useState<"all" | SessionStatus>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TicketListResponse>({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const params = useMemo(() => {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (ticketStatus !== "all") next.set("ticketStatus", ticketStatus);
    if (sessionStatus !== "all") next.set("sessionStatus", sessionStatus);
    next.set("page", String(page));
    next.set("pageSize", String(PAGE_SIZE));
    return next;
  }, [query, ticketStatus, sessionStatus, page]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/admin/tickets?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load tickets.");
        }
        return response.json() as Promise<TicketListResponse>;
      })
      .then((payload) => setData(payload))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load tickets.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [params, refreshNonce]);

  const canGoPrev = data.page > 1;
  const canGoNext = data.totalPages > 0 && data.page < data.totalPages;
  const selectedCount = selectedSessionIds.size;
  const allVisibleSelected =
    data.items.length > 0 && data.items.every((row) => selectedSessionIds.has(row.id));

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

  function toggleSelectAllVisible(): void {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        data.items.forEach((row) => next.delete(row.id));
      } else {
        data.items.forEach((row) => next.add(row.id));
      }
      return next;
    });
  }

  async function handleBulkDelete(): Promise<void> {
    if (selectedSessionIds.size === 0 || bulkDeleting) return;
    if (
      !confirm(
        `Delete ${selectedSessionIds.size} selected ticket(s) and associated files? This cannot be undone.`
      )
    ) {
      return;
    }

    setBulkDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/admin/tickets/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: Array.from(selectedSessionIds) }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to bulk delete tickets.");
      }
      setSelectedSessionIds(new Set());
      setRefreshNonce((prev) => prev + 1);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to bulk delete tickets.");
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tickets"
        description="Browse diagnostic sessions as support tickets."
      />

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search customer, model, serial, phone..."
        />
        <select
          value={ticketStatus}
          onChange={(e) => {
            setTicketStatus(e.target.value as "all" | TicketStatus);
            setPage(1);
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          {TICKET_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={sessionStatus}
          onChange={(e) => {
            setSessionStatus(e.target.value as "all" | SessionStatus);
            setPage(1);
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          {SESSION_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <div className="mb-4 text-sm text-muted">
        {loading ? "Loading..." : `${data.total} ticket${data.total === 1 ? "" : "s"}`}
      </div>
      {selectedCount > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <Button
            variant="danger"
            size="sm"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
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
          <p className="p-6 text-sm text-muted">Loading tickets...</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : data.items.length === 0 ? (
          <p className="p-6 text-sm text-muted">No tickets found.</p>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-page">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={data.items.length === 0 || bulkDeleting}
                    aria-label="Select all visible tickets"
                  />
                </th>
                <th className="px-4 py-3">Ticket ID</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Machine</th>
                <th className="px-4 py-3">Session Status</th>
                <th className="px-4 py-3">Ticket Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((row) => (
                <tr key={row.id} className="text-sm">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedSessionIds.has(row.id)}
                      onChange={() => toggleSelectOne(row.id)}
                      disabled={bulkDeleting}
                      aria-label={`Select ticket ${row.id}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tickets/${row.id}`}
                      title={row.id}
                      className="font-medium text-primary hover:underline"
                    >
                      {truncate(row.id, 18)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{row.userName ?? "-"}</div>
                    <div className="text-xs text-muted">{row.userPhone ?? "-"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{row.machineModel ?? "-"}</div>
                    <div className="text-xs text-muted">{row.serialNumber ?? "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">{row.status ?? "-"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={ticketStatusBadgeVariant(row.ticketStatus)}>
                      {ticketStatusLabel(row.ticketStatus)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatDate(row.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={!canGoPrev}
          >
            Previous
          </Button>
          <p className="text-sm text-muted">
            Page {data.page} of {data.totalPages}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={!canGoNext}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
