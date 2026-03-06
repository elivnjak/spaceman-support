"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Label = {
  id: string;
  displayName: string;
  description: string | null;
  createdAt: string | null;
};

type LabelListResponse = {
  items: Label[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZE = 20;

export default function AdminLabelsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LabelListResponse>({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const params = useMemo(() => {
    const next = new URLSearchParams();
    const trimmed = query.trim();
    if (trimmed) next.set("q", trimmed);
    next.set("page", String(page));
    next.set("pageSize", String(PAGE_SIZE));
    return next;
  }, [query, page]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/admin/labels?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load labels.");
        }
        return response.json() as Promise<LabelListResponse>;
      })
      .then((payload) => setData(payload))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load labels.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [params, refreshNonce]);

  const canGoPrev = data.page > 1;
  const canGoNext = data.totalPages > 0 && data.page < data.totalPages;

  async function handleDelete(label: Label): Promise<void> {
    if (deletingId) return;
    if (!confirm(`Delete label "${label.displayName}" (${label.id})? This cannot be undone.`)) {
      return;
    }

    setDeletingId(label.id);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/labels/${encodeURIComponent(label.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to delete label.");
      }
      setRefreshNonce((prev) => prev + 1);
      setPage((prev) => (data.items.length === 1 && prev > 1 ? prev - 1 : prev));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete label.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Labels"
        actions={
          <Link
            href="/admin/labels/new"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover min-h-[44px]"
          >
            Add label
          </Link>
        }
      />

      <section className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by label name or id..."
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setQuery("");
            setPage(1);
          }}
          disabled={!query}
        >
          Clear search
        </Button>
      </section>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {deleteError && <p className="mb-4 text-sm text-red-600">{deleteError}</p>}

      {!loading && data.total > 0 && (
        <div className="mb-4 text-right text-sm text-muted">
          {(() => {
            const from = (data.page - 1) * data.pageSize + 1;
            const to = Math.min(data.page * data.pageSize, data.total);
            return `Showing ${from}–${to} of ${data.total} label${data.total === 1 ? "" : "s"}`;
          })()}
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        {loading ? (
          <p className="p-6 text-sm text-muted">Loading labels...</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : data.items.length === 0 ? (
          <p className="p-6 text-sm text-muted">No labels found.</p>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-page">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((label) => (
                <tr key={label.id} className="text-sm">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/labels/${encodeURIComponent(label.id)}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {label.displayName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{label.id}</td>
                  <td className="px-4 py-3 text-muted">{label.description || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/labels/${encodeURIComponent(label.id)}`}
                        className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-page"
                      >
                        Edit
                      </Link>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deletingId === label.id}
                        onClick={() => handleDelete(label)}
                      >
                        {deletingId === label.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && data.total > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {data.totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={!canGoPrev}
                aria-label="First page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={!canGoPrev}
                aria-label="Previous page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ‹
              </button>

              {(() => {
                const pages: (number | "...")[] = [];
                const total = data.totalPages;
                const current = data.page;

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
                onClick={() => setPage((prev) => Math.min(data.totalPages, prev + 1))}
                disabled={!canGoNext}
                aria-label="Next page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setPage(data.totalPages)}
                disabled={!canGoNext}
                aria-label="Last page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                »
              </button>
            </div>
          )}
          <p className="text-sm text-muted">
            {(() => {
              const from = (data.page - 1) * data.pageSize + 1;
              const to = Math.min(data.page * data.pageSize, data.total);
              return `Showing ${from}–${to} of ${data.total} label${data.total === 1 ? "" : "s"}`;
            })()}
          </p>
        </div>
      )}
    </div>
  );
}
