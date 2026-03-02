"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

type Label = { id: string; displayName: string };
type RefImage = {
  id: string;
  labelId: string;
  filePath: string;
  fileHash: string | null;
  notes: string | null;
  createdAt: string;
};

export default function AdminImagesPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [images, setImages] = useState<RefImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"select" | "upload" | "confirm">("select");
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ id: string; filePath: string; duplicate?: boolean }[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/labels").then((r) => r.json()),
      fetch("/api/admin/images").then((r) => r.json()),
    ]).then(([l, im]) => {
      setLabels(l);
      setImages(im);
      setLoading(false);
    });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files;
    if (f) setFiles(Array.from(f));
  };

  const startUpload = () => {
    if (!selectedLabelId) return;
    if (files.length) setStep("confirm");
  };

  const confirmUpload = async () => {
    setUploading(true);
    setUploadResult(null);
    try {
      const form = new FormData();
      form.set("labelId", selectedLabelId);
      form.set("notes", notes);
      files.forEach((file) => form.append("files", file));
      const res = await fetch("/api/admin/images", { method: "POST", body: form });
      const result = await res.json();
      setUploadResult(result);
      if (res.ok) {
        const listRes = await fetch("/api/admin/images");
        const list = await listRes.json();
        setImages(list);
        setStep("select");
        setFiles([]);
        setNotes("");
      }
    } finally {
      setUploading(false);
    }
  };

  const updateLabel = async (imageId: string, labelId: string) => {
    await fetch(`/api/admin/images/${imageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelId }),
    });
    setImages((prev) =>
      prev.map((im) => (im.id === imageId ? { ...im, labelId } : im))
    );
  };

  const deleteOne = async (id: string) => {
    await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
    setImages((prev) => prev.filter((im) => im.id !== id));
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      await fetch("/api/admin/images/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setImages((prev) => prev.filter((im) => !selectedIds.has(im.id)));
      setSelectedIds(new Set());
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <PageHeader title="Reference images" />

      {/* Upload flow */}
      <Card className="mb-8">
        <h2 className="mb-4 font-medium">Upload images</h2>
        {step === "select" && (
          <>
            <p className="mb-2 text-sm text-muted">
              What label should these images be?
            </p>
            <select
              className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-ink"
              value={selectedLabelId}
              onChange={(e) => setSelectedLabelId(e.target.value)}
            >
              <option value="">Select label</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.displayName}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-4">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="text-sm"
              />
              <Button
                type="button"
                disabled={!selectedLabelId || files.length === 0}
                onClick={startUpload}
              >
                Next: confirm
              </Button>
            </div>
          </>
        )}
        {step === "confirm" && (
          <>
            <p className="mb-2 text-sm text-muted">
              Are these correct? ({files.length} file(s), label:{" "}
              {labels.find((l) => l.id === selectedLabelId)?.displayName})
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <Badge key={i}>{f.name}</Badge>
              ))}
            </div>
            <Input
              type="text"
              placeholder="Optional notes"
              className="mb-4 mr-4 w-auto"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={confirmUpload}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Upload"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep("select")}
              >
                Back
              </Button>
            </div>
            {uploadResult && (
              <ul className="mt-4 text-sm">
                {uploadResult.map((r) => (
                  <li key={r.id}>
                    {r.duplicate ? "Duplicate skipped" : "Uploaded"} {r.filePath}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {/* Bulk delete */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="danger"
            onClick={bulkDelete}
            disabled={bulkDeleting}
          >
            Delete selected ({selectedIds.size})
          </Button>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {images.map((im) => (
          <Card key={im.id} padding="sm">
            <div className="mb-2 flex items-start justify-between">
              <input
                type="checkbox"
                checked={selectedIds.has(im.id)}
                onChange={() => toggleSelect(im.id)}
                className="mt-1"
              />
              <button
                type="button"
                onClick={() => deleteOne(im.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
            <div className="relative aspect-square overflow-hidden rounded bg-page">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/reference-image/${im.id}`}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
            <div className="mt-2">
              <select
                value={im.labelId}
                onChange={(e) => updateLabel(im.id, e.target.value)}
                className="w-full rounded-lg border border-border bg-surface text-sm text-ink"
              >
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.displayName}
                  </option>
                ))}
              </select>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
