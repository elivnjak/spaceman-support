"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

type Label = {
  id: string;
  displayName: string;
};

type BulkItemStatus =
  | "pending"
  | "uploading"
  | "ingesting"
  | "queued"
  | "done"
  | "failed";

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

export default function AdminDocsNewPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [uploadMode, setUploadMode] = useState<"file" | "paste" | "url">("file");
  const [urlsText, setUrlsText] = useState("");
  const [cssSelector, setCssSelector] = useState(".KbDetailLtContainer__articleContent");
  const [renderJs, setRenderJs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [bulkProgress, setBulkProgress] = useState<
    { label: string; status: BulkItemStatus; error?: string | null }[] | null
  >(null);

  useEffect(() => {
    const load = async () => {
      try {
        const labelsRes = await fetchJsonSafe("/api/admin/labels");
        setLabels(toArray<Label>(labelsRes.data));
      } catch {
        setLabels([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
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
      const failed: { url: string; error: string }[] = [];
      let successCount = 0;

      for (let i = 0; i < urls.length; i++) {
        setBulkProgress((prev) =>
          prev
            ? prev.map((p, j) => (j === i ? { ...p, status: "ingesting" as const } : p))
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
            const message = data.error ?? "Request failed";
            failed.push({ url: urls[i], error: message });
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i ? { ...p, status: "failed" as const, error: message } : p
                  )
                : null
            );
          } else {
            const accepted = res.status === 202 || data.status === "queued" || data.status === "already_running";
            if (accepted) successCount += 1;
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i
                      ? {
                          ...p,
                          status: accepted ? ("queued" as const) : ("failed" as const),
                          error: accepted ? null : (data.errorMessage ?? "Queueing failed"),
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
                  j === i ? { ...p, status: "failed" as const, error: message } : p
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
      alert(`Queued: ${successCount} accepted, ${failed.length} failed.`);
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
          setTitle("");
          setPastedText("");
          setMachineModel("");
          setSelectedLabelIds([]);
          alert("Document added.");
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error ?? "Failed to add document.");
        }
      } finally {
        setUploading(false);
      }
      return;
    }

    if (uploadMode === "file") {
      if (files.length === 0) return;
      setUploading(true);
      setBulkProgress(files.map((f) => ({ label: f.name, status: "pending" as const })));
      const failed: { label: string; error: string }[] = [];
      let successCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBulkProgress((prev) =>
          prev
            ? prev.map((p, j) => (j === i ? { ...p, status: "uploading" as const } : p))
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
                    j === i ? { ...p, status: "failed" as const, error: msg } : p
                  )
                : null
            );
            continue;
          }
          const doc = (await uploadRes.json()) as { id: string };
          setBulkProgress((prev) =>
            prev
              ? prev.map((p, j) => (j === i ? { ...p, status: "ingesting" as const } : p))
              : null
          );
          const ingestRes = await fetch(`/api/admin/docs/${doc.id}/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (ingestRes.ok) {
            successCount += 1;
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) => (j === i ? { ...p, status: "queued" as const } : p))
                : null
            );
          } else {
            const err = await ingestRes.json();
            const msg = err.error ?? "Ingestion failed";
            failed.push({ label: file.name, error: msg });
            setBulkProgress((prev) =>
              prev
                ? prev.map((p, j) =>
                    j === i ? { ...p, status: "failed" as const, error: msg } : p
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
                  j === i ? { ...p, status: "failed" as const, error: message } : p
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
      alert(`Queued: ${successCount} accepted, ${failed.length} failed.`);
      if (failed.length > 0) {
        const summary = failed.map((f) => `${f.label}: ${f.error}`).join("\n");
        alert(`${failed.length} file(s) failed:\n\n${summary}`);
      }
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Add document" description="Upload files, paste text, or ingest from URLs." />

      <div className="mb-4">
        <Link href="/admin/docs" className="text-sm text-primary hover:underline">
          Back to documents
        </Link>
      </div>

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
          <p className="mb-2 text-sm font-medium text-ink">Labels for retrieval scope (optional)</p>
          <p className="mb-2 text-xs text-muted">
            Tag this document with one or more labels so retrieval prefers it when diagnosing that issue.
          </p>
          {labels.length === 0 ? (
            <p className="text-sm text-amber-600">No labels yet. Add labels in Admin → Labels first.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {labels.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedLabelIds.includes(l.id)}
                    onChange={(e) =>
                      setSelectedLabelIds((prev) =>
                        e.target.checked ? [...prev, l.id] : prev.filter((id) => id !== l.id)
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
                        : p.status === "queued"
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
                            : p.status === "queued"
                              ? "queued"
                            : `failed: ${p.error ?? "unknown"}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </div>
  );
}
