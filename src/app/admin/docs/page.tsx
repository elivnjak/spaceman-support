"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Doc = {
  id: string;
  title: string;
  filePath: string;
  status: string;
  errorMessage: string | null;
  rawTextPreview: string | null;
  pastedContent: string | null;
  machineModel: string | null;
  sourceUrl: string | null;
  cssSelector: string | null;
  renderJs: boolean | null;
  createdAt: string;
  chunkCount?: number;
};

type DocType = "pdf" | "txt" | "md" | "pasted" | "html";

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
    pdf: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    txt: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    md: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pasted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    html: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  };
  return (
    <span className={`${base} ${styles[type]}`} title={getDocTypeLabel(type)}>
      {getDocTypeLabel(type)}
    </span>
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

export default function AdminDocsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [uploadMode, setUploadMode] = useState<"file" | "paste" | "url">("file");
  const [urlsText, setUrlsText] = useState("");
  const [cssSelector, setCssSelector] = useState('.KbDetailLtContainer__articleContent');
  const [renderJs, setRenderJs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  type BulkItemStatus = "pending" | "uploading" | "ingesting" | "done" | "failed";
  const [bulkProgress, setBulkProgress] = useState<
    { label: string; status: BulkItemStatus; doc?: Doc; error?: string | null }[] | null
  >(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPastedContent, setEditPastedContent] = useState("");
  const [editMachineModel, setEditMachineModel] = useState("");
  const [editCssSelector, setEditCssSelector] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/docs")
      .then((r) => r.json())
      .then(setDocs)
      .finally(() => setLoading(false));
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadMode === "url") {
      const urls = urlsText
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (urls.length === 0) return;
      setUploading(true);
      setBulkProgress(urls.map((url) => ({ label: url, status: "pending" as const })));
      const successful: Doc[] = [];
      const failed: { url: string; error: string }[] = [];
      for (let i = 0; i < urls.length; i++) {
        setBulkProgress((prev) =>
          prev
            ? prev.map((p, j) =>
                j === i ? { ...p, status: "ingesting" as const } : p
              )
            : null
        );
        try {
          const res = await fetch("/api/admin/docs/ingest-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: urls[i],
              cssSelector: cssSelector.trim() || undefined,
              renderJs,
              machineModel: machineModel.trim() || undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            failed.push({ url: urls[i], error: data.error ?? "Request failed" });
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i
                      ? { ...p, status: "failed" as const, error: data.error }
                      : p
                  )
                : null
            );
          } else {
            const doc = { ...data, chunkCount: data.chunkCount ?? 0 };
            successful.push(doc);
            setDocs((prev) => [...prev, doc]);
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i
                      ? {
                          ...p,
                          status: data.status === "READY" ? ("done" as const) : ("failed" as const),
                          doc,
                          error: data.errorMessage,
                        }
                      : p
                  )
                : null
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failed.push({ url: urls[i], error: message });
          setBulkProgress((prev) =>
            prev
              ? prev.map((p, j) =>
                  j === i
                    ? { ...p, status: "failed" as const, error: message }
                    : p
                )
              : null
          );
        }
      }
      setUploading(false);
      setBulkProgress(null);
      setUrlsText("");
      setMachineModel("");
      if (failed.length > 0) {
        const summary = failed.map((f) => `${f.url}: ${f.error}`).join("\n");
        alert(`${failed.length} URL(s) failed:\n\n${summary}`);
      }
      return;
    }
    if (uploadMode === "paste") {
      if (!title.trim()) return;
      setUploading(true);
      try {
        const form = new FormData();
        form.set("title", title);
        form.set("pastedText", pastedText);
        if (machineModel.trim()) form.set("machineModel", machineModel.trim());
        const res = await fetch("/api/admin/docs", {
          method: "POST",
          body: form,
        });
        if (res.ok) {
          const doc = await res.json();
          setDocs((prev) => [...prev, { ...doc, chunkCount: 0 }]);
          setTitle("");
          setPastedText("");
          setMachineModel("");
        }
      } finally {
        setUploading(false);
      }
      return;
    }
    if (uploadMode === "file") {
      if (files.length === 0) return;
      setUploading(true);
      setBulkProgress(
        files.map((f) => ({ label: f.name, status: "pending" as const }))
      );
      const failed: { label: string; error: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBulkProgress((prev) =>
          prev
            ? prev.map((p, j) =>
                j === i ? { ...p, status: "uploading" as const } : p
              )
            : null
        );
        try {
          const form = new FormData();
          if (title.trim()) form.set("title", title.trim());
          form.set("file", file);
          if (machineModel.trim()) form.set("machineModel", machineModel.trim());
          const uploadRes = await fetch("/api/admin/docs", {
            method: "POST",
            body: form,
          });
          if (!uploadRes.ok) {
            const err = await uploadRes.json();
            const msg = err.error ?? "Upload failed";
            failed.push({ label: file.name, error: msg });
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i
                      ? { ...p, status: "failed" as const, error: msg }
                      : p
                  )
                : null
            );
            continue;
          }
          const doc = (await uploadRes.json()) as Doc;
          setBulkProgress((prev) =>
            prev
              ? prev.map((p, j) =>
                  j === i ? { ...p, status: "ingesting" as const } : p
                )
              : null
          );
          const ingestRes = await fetch(`/api/admin/docs/${doc.id}/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (ingestRes.ok) {
            const listRes = await fetch("/api/admin/docs");
            const list = await listRes.json();
            setDocs(list);
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i
                      ? {
                          ...p,
                          status: "done" as const,
                          doc: list.find((d: Doc) => d.id === doc.id) ?? doc,
                        }
                      : p
                  )
                : null
            );
          } else {
            const err = await ingestRes.json();
            const msg = err.error ?? "Ingestion failed";
            failed.push({ label: file.name, error: msg });
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i
                      ? { ...p, status: "failed" as const, error: msg }
                      : p
                  )
                : null
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failed.push({ label: file.name, error: message });
          setBulkProgress((prev) =>
            prev
              ? prev.map((p, j) =>
                  j === i
                    ? { ...p, status: "failed" as const, error: message }
                    : p
                )
              : null
          );
        }
      }
      setUploading(false);
      setBulkProgress(null);
      setTitle("");
      setFiles([]);
      setMachineModel("");
      if (failed.length > 0) {
        const summary = failed.map((f) => `${f.label}: ${f.error}`).join("\n");
        alert(`${failed.length} file(s) failed:\n\n${summary}`);
      }
    }
  };

  const ingest = async (id: string, pasted?: string) => {
    setIngestingId(id);
    try {
      const res = await fetch(`/api/admin/docs/${id}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pasted != null ? { pastedText: pasted } : {}),
      });
      if (res.ok) {
        const listRes = await fetch("/api/admin/docs");
        const list = await listRes.json();
        setDocs(list);
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
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditPastedContent("");
    setEditMachineModel("");
    setEditCssSelector("");
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
      } = {
        title: editTitle,
        machineModel: editMachineModel.trim() || null,
        cssSelector: editCssSelector.trim() || null,
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

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Documents</h1>

      <form onSubmit={handleUpload} className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 font-medium">Add document</h2>
        <div className="mb-4 flex gap-4">
          <label>
            <input
              type="radio"
              checked={uploadMode === "file"}
              onChange={() => setUploadMode("file")}
            />
            <span className="ml-2">Upload file</span>
          </label>
          <label>
            <input
              type="radio"
              checked={uploadMode === "paste"}
              onChange={() => setUploadMode("paste")}
            />
            <span className="ml-2">Paste text</span>
          </label>
          <label>
            <input
              type="radio"
              checked={uploadMode === "url"}
              onChange={() => setUploadMode("url")}
            />
            <span className="ml-2">URL</span>
          </label>
        </div>
        {uploadMode !== "url" && (
          <input
            type="text"
            placeholder={uploadMode === "file" ? "Title (optional; filename used if blank)" : "Title"}
            className="mb-4 mr-4 rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required={uploadMode === "paste"}
          />
        )}
        <input
          type="text"
          placeholder="Machine model (optional)"
          className="mb-4 mr-4 rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          value={machineModel}
          onChange={(e) => setMachineModel(e.target.value)}
        />
        {uploadMode === "file" && (
          <input
            type="file"
            accept=".pdf,.txt,.md"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="mb-4 block"
          />
        )}
        {uploadMode === "paste" && (
          <textarea
            placeholder="Paste document content here"
            className="mb-4 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            rows={6}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />
        )}
        {uploadMode === "url" && (
          <>
            <textarea
              placeholder="One URL per line (e.g. https://example.com/page)"
              className="mb-2 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              rows={5}
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
            />
            <input
              type="text"
              placeholder="Optional CSS selector (e.g. .articleDetail, #main-content, article)"
              className="mb-2 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              value={cssSelector}
              onChange={(e) => setCssSelector(e.target.value)}
            />
            <label className="mb-4 flex items-center gap-2">
              <input
                type="checkbox"
                checked={renderJs}
                onChange={(e) => setRenderJs(e.target.checked)}
              />
              <span>Render JavaScript</span>
            </label>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Enable for pages that load content with JavaScript (slower).
            </p>
          </>
        )}
        <button
          type="submit"
          disabled={uploading}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Adding…" : "Add"}
        </button>
        {bulkProgress && (
          <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <p className="mb-2 font-medium">
              Processing {bulkProgress.filter((p) => p.status !== "pending").length} of{" "}
              {bulkProgress.length}…
            </p>
            <ul className="max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm text-gray-600 dark:text-gray-400">
              {bulkProgress.map((p, i) => (
                <li key={i}>
                  <span className="truncate" title={p.label}>
                    {p.label}
                  </span>{" "}
                  <span
                    className={
                      p.status === "done"
                        ? "text-green-600 dark:text-green-400"
                        : p.status === "failed"
                          ? "text-red-600 dark:text-red-400"
                          : p.status === "ingesting"
                            ? "text-amber-600 dark:text-amber-400"
                            : p.status === "uploading"
                              ? "text-blue-600 dark:text-blue-400"
                              : ""
                    }
                  >
                    {p.status === "pending"
                      ? "pending"
                      : p.status === "uploading"
                        ? "uploading…"
                        : p.status === "ingesting"
                          ? "ingesting…"
                          : p.status === "done"
                            ? "done"
                            : `failed: ${p.error ?? "unknown"}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Machine model
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Chunks
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {docs.map((d) => {
                const docType = getDocType(d.filePath);
                const isEditing = editingId === d.id;
                return (
                  <tr key={d.id} className="bg-white dark:bg-gray-800">
                    <td className="whitespace-nowrap px-4 py-3">
                      <DocTypeBadge type={docType} />
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <span className="font-medium">{d.title}</span>
                      ) : (
                        <Link
                          href={`/admin/docs/${d.id}`}
                          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {d.title}
                        </Link>
                      )}
                      {d.errorMessage && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {d.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[14rem] px-4 py-3">
                      {d.machineModel ? (
                        <span
                          className="block truncate text-sm text-gray-500 dark:text-gray-400"
                          title={d.machineModel}
                        >
                          {d.machineModel}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500 dark:text-gray-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          d.status === "READY"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : d.status === "ERROR"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              : d.status === "INGESTING"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30"
                                : "bg-gray-100 dark:bg-gray-700"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {d.chunkCount ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(d.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => ingest(d.id)}
                          disabled={ingestingId === d.id || d.status === "INGESTING"}
                          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 disabled:opacity-50"
                        >
                          {ingestingId === d.id ? "Ingesting…" : "Ingest"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDoc(d.id)}
                          disabled={deletingId === d.id}
                          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
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
          <div className="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <p className="mb-3 font-medium">Edit document</p>
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
              {docs.find((d) => d.id === editingId)?.filePath === "_url" && (
                <input
                  type="text"
                  placeholder="Optional CSS selector (e.g. .articleDetail, #main-content, article)"
                  className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                  value={editCssSelector}
                  onChange={(e) => setEditCssSelector(e.target.value)}
                />
              )}
              {docs.find((d) => d.id === editingId)?.filePath === "_pasted" && (
                <textarea
                  placeholder="Paste document content"
                  className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
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
                  className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {docs.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
            No documents yet. Add one above.
          </p>
        )}
      </div>
    </div>
  );
}
