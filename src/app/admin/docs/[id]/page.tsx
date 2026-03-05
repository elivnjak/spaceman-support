"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatDateAu } from "@/lib/date-format";

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
  createdAt: string;
};

type Label = {
  id: string;
  displayName: string;
};

type Chunk = {
  id: string;
  chunkIndex: number;
  content: string;
  metadata: unknown;
};

type DocType = "pdf" | "txt" | "md" | "pasted";

function getDocType(filePath: string): DocType {
  if (filePath === "_pasted") return "pasted";
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
  };
  return (
    <span className={`${base} ${styles[type]}`}>{getDocTypeLabel(type)}</span>
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

export default function AdminDocDetailPage() {
  const params = useParams();
  const id = params?.id as string | undefined;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [chunkSearch, setChunkSearch] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editMachineModel, setEditMachineModel] = useState("");
  const [editPastedContent, setEditPastedContent] = useState("");
  const [editCssSelector, setEditCssSelector] = useState("");
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/admin/docs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setDoc)
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (!doc || (doc.status !== "PENDING" && doc.status !== "INGESTING")) return;
    const intervalId = window.setInterval(async () => {
      const latest = await fetch(`/api/admin/docs/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (latest) setDoc(latest);
      if (latest && (latest.status === "READY" || latest.status === "ERROR")) {
        const chunksRes = await fetch(`/api/admin/docs/${id}/chunks`);
        setChunks(await chunksRes.json());
      }
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [id, doc]);

  useEffect(() => {
    fetch("/api/admin/labels")
      .then((r) => r.json())
      .then(setLabels)
      .catch(() => setLabels([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    const q = chunkSearch ? `?search=${encodeURIComponent(chunkSearch)}` : "";
    fetch(`/api/admin/docs/${id}/chunks${q}`)
      .then((r) => r.json())
      .then(setChunks);
  }, [id, chunkSearch]);

  const ingest = async () => {
    if (!doc) return;
    setIngesting(true);
    try {
      const res = await fetch(`/api/admin/docs/${doc.id}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          doc.filePath === "_pasted" && doc.pastedContent
            ? JSON.stringify({ pastedText: doc.pastedContent })
            : "{}",
      });
      if (res.ok) {
        const updated = await fetch(`/api/admin/docs/${doc.id}`).then((r) =>
          r.json()
        );
        setDoc(updated);
        const chunksRes = await fetch(`/api/admin/docs/${doc.id}/chunks`);
        setChunks(await chunksRes.json());
      } else {
        const err = await res.json();
        setDoc((prev) =>
          prev
            ? {
                ...prev,
                status: "ERROR",
                errorMessage: err.error ?? "Ingest failed",
              }
            : null
        );
      }
    } finally {
      setIngesting(false);
    }
  };

  const startEdit = () => {
    if (!doc) return;
    setEditing(true);
    setEditTitle(doc.title);
    setEditMachineModel(doc.machineModel ?? "");
    setEditPastedContent(doc.pastedContent ?? "");
    setEditCssSelector(doc.cssSelector ?? "");
    setEditLabelIds(doc.labelIds ?? []);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!doc) return;
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
      if (doc.filePath === "_pasted") body.pastedContent = editPastedContent;
      const res = await fetch(`/api/admin/docs/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setDoc(updated);
        cancelEdit();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteDoc = async () => {
    if (!doc) return;
    if (!confirm("Delete this document? Chunks will be removed. This cannot be undone."))
      return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/docs/${doc.id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.href = "/admin/docs";
        return;
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!doc) return <p>Document not found.</p>;

  const docType = getDocType(doc.filePath);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/admin/docs"
          className="text-muted hover:text-ink"
        >
          ← Back to documents
        </Link>
      </div>

      <header className="mb-8 rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{doc.title}</h1>
          <DocTypeBadge type={docType} />
          <span
            className={`rounded px-2 py-0.5 text-sm font-medium ${
              doc.status === "READY"
                ? "bg-emerald-50 text-emerald-700"
                : doc.status === "ERROR"
                  ? "bg-red-50 text-red-700"
                  : doc.status === "PENDING"
                    ? "bg-slate-100 text-slate-700"
                  : doc.status === "INGESTING"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-page"
            }`}
          >
            {doc.status}
          </span>
          {doc.machineModel && (
            <span className="text-sm text-muted">
              Machine: {doc.machineModel}
            </span>
          )}
          {doc.labelIds && doc.labelIds.length > 0 && (
            <span className="text-sm text-muted">
              Labels: {doc.labelIds.join(", ")}
            </span>
          )}
          <span className="text-sm text-muted">
            Created {formatDate(doc.createdAt)}
          </span>
        </div>
        {doc.errorMessage && (
          <p className="mb-4 text-sm text-red-600">
            {doc.errorMessage}
          </p>
        )}
        {(doc.status === "PENDING" || doc.status === "INGESTING") && (
          <div className="mb-4 max-w-lg">
            <div className="h-2 rounded bg-page">
              <div
                className="h-2 rounded bg-primary transition-all"
                style={{ width: `${Math.max(0, Math.min(100, doc.ingestionProgress ?? 0))}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted">
              {doc.ingestionStage ?? "Working..."} ({Math.max(0, Math.min(100, doc.ingestionProgress ?? 0))}%)
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={ingest}
            disabled={ingesting || doc.status === "INGESTING" || doc.status === "PENDING"}
            className="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {ingesting ? "Queueing…" : doc.status === "PENDING" || doc.status === "INGESTING" ? "Ingestion running..." : "Ingest / Re-ingest"}
          </button>
          <button
            type="button"
            onClick={editing ? cancelEdit : startEdit}
            className="rounded border border-border px-3 py-1.5 text-sm"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            onClick={deleteDoc}
            disabled={deleting}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </header>

      {editing && (
        <div className="mb-8 rounded-lg border border-border bg-page p-6">
          <h2 className="mb-4 font-medium">Edit document</h2>
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
            {doc.filePath === "_url" && (
              <input
                type="text"
                placeholder="Optional CSS selector (e.g. .articleDetail, #main-content, article)"
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                value={editCssSelector}
                onChange={(e) => setEditCssSelector(e.target.value)}
              />
            )}
            {doc.filePath === "_pasted" && (
              <textarea
                placeholder="Paste document content"
                className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                rows={10}
                value={editPastedContent}
                onChange={(e) => setEditPastedContent(e.target.value)}
              />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="rounded bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {doc.rawTextPreview && (
        <section className="mb-8 rounded-lg border border-border bg-surface p-6">
          <h2 className="mb-3 font-medium">Raw text preview (first ~1000 chars)</h2>
          <p className="mb-2 text-sm text-muted">
            Initial extraction before chunking. Use this to verify the source was read correctly.
          </p>
          <pre className="max-h-80 overflow-auto rounded bg-page p-4 text-sm whitespace-pre-wrap break-words">
            {doc.rawTextPreview}
          </pre>
          {doc.rawTextPreview.length < 100 && (
            <p className="mt-2 text-sm text-amber-600">
              This PDF may be scanned or image-only. Try uploading a text version or pasting the
              content manually.
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="mb-3 font-medium">Ingested chunks (RAG content)</h2>
        <p className="mb-4 text-sm text-muted">
          {chunks.length} chunk(s) in the vector store. Search to filter by content.
        </p>
        <input
          type="text"
          placeholder="Search chunks…"
          className="mb-4 w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          value={chunkSearch}
          onChange={(e) => setChunkSearch(e.target.value)}
        />
        <ul className="space-y-4">
          {chunks.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-page p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium text-muted">
                  Chunk #{c.chunkIndex}
                </span>
                {c.metadata && typeof c.metadata === "object" && Object.keys(c.metadata as object).length > 0 ? (
                  <span className="text-xs text-muted">
                    {JSON.stringify(c.metadata)}
                  </span>
                ) : null}
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
                {c.content}
              </pre>
            </li>
          ))}
        </ul>
        {chunks.length === 0 && (
          <p className="py-8 text-center text-muted">
            No chunks yet. Run Ingest to chunk and embed this document.
          </p>
        )}
      </section>
    </div>
  );
}
