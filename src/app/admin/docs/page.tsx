"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

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
  renderJs: boolean | null;
  createdAt: string;
  chunkCount?: number;
};

type Label = {
  id: string;
  displayName: string;
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
  const [labels, setLabels] = useState<Label[]>([]);
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
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
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
  const [editLabelIds, setEditLabelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/docs")
      .then((r) => r.json())
      .then(setDocs)
      .finally(() => setLoading(false));
    fetch("/api/admin/labels")
      .then((r) => r.json())
      .then(setLabels)
      .catch(() => setLabels([]));
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
              labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
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
      setSelectedLabelIds([]);
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
        if (selectedLabelIds.length > 0) {
          form.set("labelIds", JSON.stringify(selectedLabelIds));
        }
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
          setSelectedLabelIds([]);
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
          if (selectedLabelIds.length > 0) {
            form.set("labelIds", JSON.stringify(selectedLabelIds));
          }
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
      setSelectedLabelIds([]);
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

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <PageHeader title="Documents" />

      <form onSubmit={handleUpload} className="mb-8 rounded-lg border border-border bg-surface p-6">
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
            className="mb-4 mr-4 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required={uploadMode === "paste"}
          />
        )}
        <input
          type="text"
          placeholder="Machine model (optional)"
          className="mb-4 mr-4 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          value={machineModel}
          onChange={(e) => setMachineModel(e.target.value)}
        />
        <div className="mb-4 rounded border border-border bg-page p-3">
          <p className="mb-2 text-sm font-medium text-ink">
            Labels for retrieval scope (optional)
          </p>
          <p className="mb-2 text-xs text-muted">
            Tag this document with one or more labels so retrieval prefers it when diagnosing that issue.
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
                    checked={selectedLabelIds.includes(l.id)}
                    onChange={(e) =>
                      setSelectedLabelIds((prev) =>
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
            className="mb-4 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
            rows={6}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />
        )}
        {uploadMode === "url" && (
          <>
            <textarea
              placeholder="One URL per line (e.g. https://example.com/page)"
              className="mb-2 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
              rows={5}
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
            />
            <input
              type="text"
              placeholder="Optional CSS selector (e.g. .articleDetail, #main-content, article)"
              className="mb-2 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
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
            <p className="mb-4 text-xs text-muted">
              Enable for pages that load content with JavaScript (slower).
            </p>
          </>
        )}
        <button
          type="submit"
          disabled={uploading}
          className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {uploading ? "Adding…" : "Add"}
        </button>
        {bulkProgress && (
          <div className="mt-4 rounded border border-border bg-page p-4">
            <p className="mb-2 font-medium">
              Processing {bulkProgress.filter((p) => p.status !== "pending").length} of{" "}
              {bulkProgress.length}…
            </p>
            <ul className="max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm text-muted">
              {bulkProgress.map((p, i) => (
                <li key={i}>
                  <span className="truncate" title={p.label}>
                    {p.label}
                  </span>{" "}
                  <span
                    className={
                      p.status === "done"
                        ? "text-emerald-600"
                        : p.status === "failed"
                          ? "text-red-600"
                          : p.status === "ingesting"
                            ? "text-amber-600"
                            : p.status === "uploading"
                              ? "text-primary"
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
              {docs.map((d) => {
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
                              : d.status === "INGESTING"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-page"
                        }`}
                      >
                        {d.status}
                      </span>
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
                          disabled={ingestingId === d.id || d.status === "INGESTING"}
                          className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                        >
                          {ingestingId === d.id ? "Ingesting…" : "Ingest"}
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

        {docs.length === 0 && (
          <p className="px-4 py-8 text-center text-muted">
            No documents yet. Add one above.
          </p>
        )}
      </div>
    </div>
  );
}
