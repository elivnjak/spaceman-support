"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

type SupportedModel = {
  id: string;
  modelNumber: string;
  displayName: string | null;
};

export default function AdminModelsPage() {
  const [models, setModels] = useState<SupportedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  async function reload() {
    const res = await fetch("/api/admin/supported-models");
    const data = await res.json();
    setModels(data);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  async function remove(id: string) {
    await fetch("/api/admin/supported-models", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await reload();
  }

  const sortedModels = useMemo(
    () => [...models].sort((a, b) => a.modelNumber.localeCompare(b.modelNumber)),
    [models]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return sortedModels;
    return sortedModels.filter((model) => {
      const modelNumber = model.modelNumber.toLowerCase();
      const displayName = (model.displayName ?? "").toLowerCase();
      return modelNumber.includes(normalizedQuery) || displayName.includes(normalizedQuery);
    });
  }, [sortedModels, normalizedQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedModels = filteredModels.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Supported models"
        description="View and remove currently configured models."
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Manage models</h2>
            <p className="text-sm text-muted">
              Add single models or bulk import from the dedicated page.
            </p>
          </div>
          <Link
            href="/admin/models/manage"
            className="rounded bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Open add/bulk import
          </Link>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Current supported models</h2>
          <p className="text-sm text-muted">
            {filteredModels.length} shown / {models.length} total
          </p>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by model number or display name..."
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          />
          <select
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
            aria-label="Rows per page"
          >
            <option value="10">10 / page</option>
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
          <button
            type="button"
            onClick={() => setQuery("")}
            disabled={!query}
            className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted hover:bg-page disabled:opacity-50"
          >
            Clear filter
          </button>
        </div>

        <div className="space-y-2">
          {paginatedModels.map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div>
                <p className="font-mono text-sm text-ink">{model.modelNumber}</p>
                {model.displayName ? (
                  <p className="text-xs text-muted">{model.displayName}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => remove(model.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
          {models.length === 0 ? (
            <p className="text-sm text-muted">No supported models configured yet.</p>
          ) : filteredModels.length === 0 ? (
            <p className="text-sm text-muted">No models match the current filter.</p>
          ) : null}
        </div>

        {filteredModels.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted">
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredModels.length)} of {filteredModels.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={safePage <= 1}
                className="rounded border border-border px-2.5 py-1.5 text-sm text-ink hover:bg-page disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-sm text-muted">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={safePage >= totalPages}
                className="rounded border border-border px-2.5 py-1.5 text-sm text-ink hover:bg-page disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
