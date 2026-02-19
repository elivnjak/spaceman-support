"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Doc = {
  id: string;
  title: string;
  filePath: string;
  status: string;
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
    pdf: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    txt: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    md: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pasted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  };
  return (
    <span className={`${base} ${styles[type]}`}>{getDocTypeLabel(type)}</span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
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
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          ← Back to documents
        </Link>
      </div>

      <header className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{doc.title}</h1>
          <DocTypeBadge type={docType} />
          <span
            className={`rounded px-2 py-0.5 text-sm font-medium ${
              doc.status === "READY"
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                : doc.status === "ERROR"
                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  : doc.status === "INGESTING"
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30"
                    : "bg-gray-100 dark:bg-gray-700"
            }`}
          >
            {doc.status}
          </span>
          {doc.machineModel && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Machine: {doc.machineModel}
            </span>
          )}
          {doc.labelIds && doc.labelIds.length > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Labels: {doc.labelIds.join(", ")}
            </span>
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Created {formatDate(doc.createdAt)}
          </span>
        </div>
        {doc.errorMessage && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">
            {doc.errorMessage}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={ingest}
            disabled={ingesting || doc.status === "INGESTING"}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 disabled:opacity-50"
          >
            {ingesting ? "Ingesting…" : "Ingest / Re-ingest"}
          </button>
          <button
            type="button"
            onClick={editing ? cancelEdit : startEdit}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            onClick={deleteDoc}
            disabled={deleting}
            className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </header>

      {editing && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="mb-4 font-medium">Edit document</h2>
          <div className="grid max-w-2xl gap-3">
            <input
              type="text"
              placeholder="Title"
              className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <input
              type="text"
              placeholder="Machine model (optional)"
              className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              value={editMachineModel}
              onChange={(e) => setEditMachineModel(e.target.value)}
            />
            <div className="rounded border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-800/50">
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Labels for retrieval scope
              </p>
              {labels.length === 0 ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">
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
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
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
                className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                value={editCssSelector}
                onChange={(e) => setEditCssSelector(e.target.value)}
              />
            )}
            {doc.filePath === "_pasted" && (
              <textarea
                placeholder="Paste document content"
                className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
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
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {doc.rawTextPreview && (
        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 font-medium">Raw text preview (first ~1000 chars)</h2>
          <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
            Initial extraction before chunking. Use this to verify the source was read correctly.
          </p>
          <pre className="max-h-80 overflow-auto rounded bg-gray-50 p-4 text-sm whitespace-pre-wrap break-words dark:bg-gray-900">
            {doc.rawTextPreview}
          </pre>
          {doc.rawTextPreview.length < 100 && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              This PDF may be scanned or image-only. Try uploading a text version or pasting the
              content manually.
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 font-medium">Ingested chunks (RAG content)</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {chunks.length} chunk(s) in the vector store. Search to filter by content.
        </p>
        <input
          type="text"
          placeholder="Search chunks…"
          className="mb-4 w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
          value={chunkSearch}
          onChange={(e) => setChunkSearch(e.target.value)}
        />
        <ul className="space-y-4">
          {chunks.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  Chunk #{c.chunkIndex}
                </span>
                {c.metadata && typeof c.metadata === "object" && Object.keys(c.metadata as object).length > 0 ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
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
          <p className="py-8 text-center text-gray-500 dark:text-gray-400">
            No chunks yet. Run Ingest to chunk and embed this document.
          </p>
        )}
      </section>
    </div>
  );
}
