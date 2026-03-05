"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { formatDateAu, formatDateTimeAu } from "@/lib/date-format";

type Doc = {
  id: string;
  title: string;
  filePath: string;
  status: string;
  ingestionProgress: number;
  ingestionStage: string | null;
  queuedAt: string | null;
  ingestionStartedAt: string | null;
  ingestionCompletedAt: string | null;
  errorMessage: string | null;
  rawTextPreview: string | null;
  pastedContent: string | null;
  machineModel: string | null;
  labelIds: string[] | null;
  sourceUrl: string | null;
  cssSelector: string | null;
  renderJs: boolean | null;
  createdAt: string;
  chunkCount?: number;
};

type Label = {
  id: string;
  displayName: string;
};

type SupportedModel = {
  id: string;
  modelNumber: string;
  displayName: string | null;
};

type DocType = "pdf" | "txt" | "md" | "pasted" | "html";

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function fetchJsonSafe(url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url);
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

function getDocType(filePath: string): DocType {
  if (filePath === "_pasted") return "pasted";
  if (filePath === "_url") return "html";
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  return "txt";
}

function getDocTypeLabel(type: DocType): string {
  switch (type) {
    case "pdf":
      return "PDF";
    case "txt":
      return "Text";
    case "md":
      return "Markdown";
    case "pasted":
      return "Pasted";
    case "html":
      return "HTML";
    default:
      return "File";
  }
}

function DocTypeBadge({ type }: { type: DocType }) {
  const base = "rounded px-2 py-0.5 text-xs font-medium";
  const styles: Record<DocType, string> = {
    pdf: "bg-red-100 text-red-800",
    txt: "bg-green-100 text-green-800",
    md: "bg-blue-100 text-blue-800",
    pasted: "bg-purple-100 text-purple-800",
    html: "bg-amber-100 text-amber-800",
  };
  return (
    <span className={`${base} ${styles[type]}`} title={getDocTypeLabel(type)}>
      {getDocTypeLabel(type)}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return formatDateAu(iso, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }, iso);
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDateTimeAu(iso, undefined, iso);
  } catch {
    return iso;
  }
}

function isActiveIngestionStatus(status: string): boolean {
  return status === "PENDING" || status === "INGESTING";
}

const INGESTION_HISTORY_HOURS = 24;
const INGESTION_HISTORY_KEY = "adminDocsHiddenIngestionHistory";

export default function AdminDocsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [supportedModels, setSupportedModels] = useState<SupportedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPastedContent, setEditPastedContent] = useState("");
  const [editMachineModel, setEditMachineModel] = useState("");
  const [editCssSelector, setEditCssSelector] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [hiddenHistoryIds, setHiddenHistoryIds] = useState<string[]>([]);

  // Filter & pagination
  const [filterQuery, setFilterQuery] = useState("");
  const [filterModel, setFilterModel] = useState("all");
  const [filterLabelId, setFilterLabelId] = useState("all");
  const [filterType, setFilterType] = useState<"all" | DocType>("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [filterQuery, filterModel, filterLabelId, filterType, filterStatus]);

  const filteredDocs = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return docs.filter((d) => {
      if (q && !d.title.toLowerCase().includes(q) && !(d.machineModel ?? "").toLowerCase().includes(q)) return false;
      if (filterModel !== "all") {
        const docModels = (d.machineModel ?? "").split(",").map((m) => m.trim()).filter(Boolean);
        if (!docModels.includes(filterModel)) return false;
      }
      if (filterLabelId !== "all" && !(d.labelIds ?? []).includes(filterLabelId)) return false;
      if (filterType !== "all" && getDocType(d.filePath) !== filterType) return false;
      if (filterStatus !== "all" && d.status !== filterStatus) return false;
      return true;
    });
  }, [docs, filterQuery, filterModel, filterLabelId, filterType, filterStatus]);

  const ingestionJobs = useMemo(() => {
    const cutoffMs = Date.now() - INGESTION_HISTORY_HOURS * 60 * 60 * 1000;
    const hidden = new Set(hiddenHistoryIds);
    return docs
      .filter((d) => {
        const active = isActiveIngestionStatus(d.status);
        const isHistory = d.status === "ERROR" || d.ingestionCompletedAt != null;
        if (!active && !isHistory) return false;
        if (!active && hidden.has(d.id)) return false;
        if (active) return true;
        const ts = new Date(
          d.ingestionCompletedAt ?? d.ingestionStartedAt ?? d.queuedAt ?? d.createdAt
        ).getTime();
        return Number.isNaN(ts) || ts >= cutoffMs;
      })
      .sort((a, b) => {
        const aTime =
          a.queuedAt ?? a.ingestionStartedAt ?? a.ingestionCompletedAt ?? a.createdAt;
        const bTime =
          b.queuedAt ?? b.ingestionStartedAt ?? b.ingestionCompletedAt ?? b.createdAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
  }, [docs, hiddenHistoryIds]);

  const activeJobsCount = useMemo(
    () => ingestionJobs.filter((j) => isActiveIngestionStatus(j.status)).length,
    [ingestionJobs]
  );
  const historyJobsCount = ingestionJobs.length - activeJobsCount;

  const totalPages = Math.ceil(filteredDocs.length / PAGE_SIZE);
  const paginatedDocs = filteredDocs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const refreshDocs = useCallback(async () => {
    const docsRes = await fetchJsonSafe("/api/admin/docs");
    setDocs(toArray<Doc>(docsRes.data));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [docsRes, labelsRes, modelsRes] = await Promise.all([
          fetchJsonSafe("/api/admin/docs"),
          fetchJsonSafe("/api/admin/labels"),
          fetchJsonSafe("/api/admin/supported-models"),
        ]);
        setDocs(toArray<Doc>(docsRes.data));
        setLabels(toArray<Label>(labelsRes.data));
        setSupportedModels(
          toArray<SupportedModel>(modelsRes.data).sort((a, b) =>
            a.modelNumber.localeCompare(b.modelNumber)
          )
        );
      } catch {
        setDocs([]);
        setLabels([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(INGESTION_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setHiddenHistoryIds(parsed.filter((v): v is string => typeof v === "string"));
    } catch {
      // ignore invalid local storage value
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        INGESTION_HISTORY_KEY,
        JSON.stringify(hiddenHistoryIds)
      );
    } catch {
      // ignore local storage failures
    }
  }, [hiddenHistoryIds]);

  useEffect(() => {
    if (!docs.some((d) => isActiveIngestionStatus(d.status))) return;
    const id = window.setInterval(() => {
      void refreshDocs();
    }, 4000);
    return () => window.clearInterval(id);
  }, [docs, refreshDocs]);

  const ingest = async (id: string, pasted?: string) => {
    setIngestingId(id);
    try {
      const res = await fetch(`/api/admin/docs/${id}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pasted != null ? { pastedText: pasted } : {}),
      });
      if (res.ok) {
        await refreshDocs();
      } else {
        const err = await res.json();
        setDocs((prev) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, status: "ERROR" as string, errorMessage: err.error }
              : d
          )
        );
      }
    } finally {
      setIngestingId(null);
    }
  };

  const startEdit = (d: Doc) => {
    setEditingId(d.id);
    setEditTitle(d.title);
    setEditPastedContent(d.pastedContent ?? "");
    setEditMachineModel(d.machineModel ?? "");
    setEditCssSelector(d.cssSelector ?? "");
    setEditLabelIds(d.labelIds ?? []);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditPastedContent("");
    setEditMachineModel("");
    setEditCssSelector("");
    setEditLabelIds([]);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const body: {
        title: string;
        pastedContent?: string;
        machineModel?: string | null;
        cssSelector?: string | null;
        labelIds?: string[] | null;
      } = {
        title: editTitle,
        machineModel: editMachineModel.trim() || null,
        cssSelector: editCssSelector.trim() || null,
        labelIds: editLabelIds,
      };
      const doc = docs.find((d) => d.id === editingId);
      if (doc?.filePath === "_pasted") body.pastedContent = editPastedContent;
      const res = await fetch(`/api/admin/docs/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setDocs((prev) =>
          prev.map((d) => (d.id === editingId ? { ...updated, chunkCount: d.chunkCount } : d))
        );
        cancelEdit();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm("Delete this document? Chunks will be removed. This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/docs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDocs((prev) => prev.filter((d) => d.id !== id));
        if (editingId === id) cancelEdit();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const clearIngestionHistory = () => {
    setHiddenHistoryIds((prev) => {
      const next = new Set(prev);
      for (const job of ingestionJobs) {
        if (!isActiveIngestionStatus(job.status)) {
          next.add(job.id);
        }
      }
      return Array.from(next);
    });
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <PageHeader title="Documents" />
      {!loading && ingestionJobs.length > 0 && (
        <section className="mb-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setJobsOpen((v) => !v)}
              className="flex items-center gap-2 text-left"
            >
              <h2 className="font-medium">Ingestion jobs</h2>
              <span className="text-xs text-muted">
                {jobsOpen ? "Hide" : "Show"} ({ingestionJobs.length})
              </span>
            </button>
            <button
              type="button"
              onClick={clearIngestionHistory}
              disabled={historyJobsCount === 0}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-page disabled:opacity-40"
            >
              Clear history
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            Active: {activeJobsCount} | History (last {INGESTION_HISTORY_HOURS}h):{" "}
            {historyJobsCount}
          </p>
          {jobsOpen && (
            <ul className="mt-3 space-y-2">
              {ingestionJobs.map((job) => (
                <li
                  key={`job-${job.id}`}
                  className="rounded border border-border bg-page p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/docs/${job.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {job.title}
                    </Link>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        job.status === "READY"
                          ? "bg-emerald-50 text-emerald-700"
                          : job.status === "ERROR"
                            ? "bg-red-50 text-red-700"
                            : job.status === "PENDING"
                              ? "bg-slate-100 text-slate-700"
                              : job.status === "INGESTING"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-page"
                      }`}
                    >
                      {job.status}
                    </span>
                    {(job.status === "PENDING" || job.status === "INGESTING") && (
                      <span className="text-xs text-muted">
                        {job.ingestionStage ?? "Working..."} (
                        {Math.max(0, Math.min(100, job.ingestionProgress ?? 0))}%)
                      </span>
                    )}
                    {job.status === "ERROR" && (
                      <button
                        type="button"
                        onClick={() => ingest(job.id)}
                        disabled={ingestingId === job.id}
                        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {ingestingId === job.id ? "Queueing..." : "Retry"}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Queued: {formatDateTime(job.queuedAt)} | Started:{" "}
                    {formatDateTime(job.ingestionStartedAt)} | Completed:{" "}
                    {formatDateTime(job.ingestionCompletedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className="mb-4 flex justify-end">
        <Link
          href="/admin/docs/new"
          className="rounded bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Add document
        </Link>
      </div>

      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Search title or model..."
        />
        <select
          value={filterModel}
          onChange={(e) => setFilterModel(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          <option value="all">All models</option>
          {supportedModels.map((m) => (
            <option key={m.id} value={m.modelNumber}>
              {m.displayName ? `${m.modelNumber} — ${m.displayName}` : m.modelNumber}
            </option>
          ))}
        </select>
        <select
          value={filterLabelId}
          onChange={(e) => setFilterLabelId(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          <option value="all">All labels</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>{l.displayName}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as "all" | DocType)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          <option value="all">All types</option>
          <option value="pdf">PDF</option>
          <option value="txt">Text</option>
          <option value="md">Markdown</option>
          <option value="pasted">Pasted</option>
          <option value="html">HTML</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
        >
          <option value="all">All statuses</option>
          <option value="READY">Ready</option>
          <option value="INGESTING">Ingesting</option>
          <option value="PENDING">Pending</option>
          <option value="ERROR">Error</option>
        </select>
      </section>

      {!loading && (
        <div className="mb-4 text-right text-sm text-muted">
          {(() => {
            const from = filteredDocs.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
            const to = Math.min(page * PAGE_SIZE, filteredDocs.length);
            return `Showing ${from}–${to} of ${filteredDocs.length} document${filteredDocs.length === 1 ? "" : "s"}`;
          })()}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead>
              <tr className="bg-page">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Machine model
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Labels
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Chunks
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedDocs.map((d) => {
                const docType = getDocType(d.filePath);
                const isEditing = editingId === d.id;
                return (
                  <tr key={d.id} className="bg-surface">
                    <td className="whitespace-nowrap px-4 py-3">
                      <DocTypeBadge type={docType} />
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <span className="font-medium">{d.title}</span>
                      ) : (
                        <Link
                          href={`/admin/docs/${d.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {d.title}
                        </Link>
                      )}
                      {d.errorMessage && (
                        <p className="mt-1 text-xs text-red-600">
                          {d.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3">
                      {d.machineModel ? (
                        <span
                          className="block truncate text-sm text-muted"
                          title={d.machineModel}
                        >
                          {d.machineModel}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3">
                      {d.labelIds && d.labelIds.length > 0 ? (
                        <span
                          className="block truncate text-sm text-muted"
                          title={d.labelIds.join(", ")}
                        >
                          {d.labelIds.join(", ")}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          d.status === "READY"
                            ? "bg-emerald-50 text-emerald-700"
                            : d.status === "ERROR"
                              ? "bg-red-50 text-red-700"
                              : d.status === "PENDING"
                                ? "bg-slate-100 text-slate-700"
                              : d.status === "INGESTING"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-page"
                        }`}
                      >
                        {d.status}
                      </span>
                      {(d.status === "PENDING" || d.status === "INGESTING") && (
                        <div className="mt-1 max-w-[11rem]">
                          <div className="h-1.5 rounded bg-page">
                            <div
                              className="h-1.5 rounded bg-primary transition-all"
                              style={{ width: `${Math.max(0, Math.min(100, d.ingestionProgress ?? 0))}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {d.ingestionStage ?? "Working..."} ({Math.max(0, Math.min(100, d.ingestionProgress ?? 0))}%)
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-muted">
                      {d.chunkCount ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-muted">
                      {formatDate(d.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => ingest(d.id)}
                          disabled={ingestingId === d.id || isActiveIngestionStatus(d.status)}
                          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                        >
                          {ingestingId === d.id ? "Queueing…" : isActiveIngestionStatus(d.status) ? "Running..." : "Ingest"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="rounded border border-border px-2 py-1 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDoc(d.id)}
                          disabled={deletingId === d.id}
                          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === d.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editingId && (
          <div className="border-t border-border bg-page p-4">
            <p className="mb-3 font-medium">Edit document</p>
            <div className="grid max-w-2xl gap-3">
              <input
                type="text"
                placeholder="Title"
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <input
                type="text"
                placeholder="Machine model (optional)"
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                value={editMachineModel}
                onChange={(e) => setEditMachineModel(e.target.value)}
              />
              <div className="rounded border border-border bg-surface p-3">
                <p className="mb-2 text-sm font-medium text-ink">
                  Labels for retrieval scope
                </p>
                {labels.length === 0 ? (
                  <p className="text-sm text-amber-600">
                    No labels yet. Add labels in Admin → Labels first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {labels.map((l) => (
                      <label key={l.id} className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editLabelIds.includes(l.id)}
                          onChange={(e) =>
                            setEditLabelIds((prev) =>
                              e.target.checked
                                ? [...prev, l.id]
                                : prev.filter((id) => id !== l.id)
                            )
                          }
                          className="rounded border-border"
                        />
                        <span className="text-sm text-ink">
                          {l.displayName} ({l.id})
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {docs.find((d) => d.id === editingId)?.filePath === "_url" && (
                <input
                  type="text"
                  placeholder="Optional CSS selector (e.g. .articleDetail, #main-content, article)"
                  className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                  value={editCssSelector}
                  onChange={(e) => setEditCssSelector(e.target.value)}
                />
              )}
              {docs.find((d) => d.id === editingId)?.filePath === "_pasted" && (
                <textarea
                  placeholder="Paste document content"
                  className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                  rows={6}
                  value={editPastedContent}
                  onChange={(e) => setEditPastedContent(e.target.value)}
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded bg-primary px-3 py-1 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded border border-border px-3 py-1 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && filteredDocs.length === 0 && (
          <p className="px-4 py-8 text-center text-muted">
            {docs.length === 0 ? "No documents yet. Add one above." : "No documents match your filters."}
          </p>
        )}
      </div>
      {!loading && filteredDocs.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {totalPages > 1 && (
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
                const total = totalPages;
                const current = page;
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
                    <span key={`ellipsis-${idx}`} className="flex h-8 w-8 items-center justify-center text-sm text-muted">…</span>
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
                disabled={!canGoNext}
                aria-label="Next page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages)}
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
              const from = (page - 1) * PAGE_SIZE + 1;
              const to = Math.min(page * PAGE_SIZE, filteredDocs.length);
              return `Showing ${from}–${to} of ${filteredDocs.length} document${filteredDocs.length === 1 ? "" : "s"}`;
            })()}
          </p>
        </div>
      )}
    </div>
  );
}
