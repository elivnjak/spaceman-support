"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";

type GuideImage = {
  id: string;
  url: string;
  notes: string | null;
  selected: boolean;
};

type ClearanceConfigPayload = {
  instructionText: string;
  guideImageIds: string[];
  guideImages: GuideImage[];
};

export default function AdminClearanceConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instructionText, setInstructionText] = useState("");
  const [guideImages, setGuideImages] = useState<GuideImage[]>([]);
  const [selectedGuideIds, setSelectedGuideIds] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");

  async function reload() {
    const res = await fetch("/api/admin/clearance-config");
    const data = (await res.json()) as ClearanceConfigPayload;
    setInstructionText(data.instructionText);
    setGuideImages(data.guideImages);
    setSelectedGuideIds(new Set(data.guideImageIds));
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  const selectedCount = useMemo(() => selectedGuideIds.size, [selectedGuideIds]);

  function toggleGuideImage(id: string) {
    setSelectedGuideIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function uploadGuideImages() {
    if (!files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      if (notes.trim()) formData.set("notes", notes.trim());
      await fetch("/api/admin/clearance-guide-images", {
        method: "POST",
        body: formData,
      });
      setFiles([]);
      setNotes("");
      await reload();
    } finally {
      setUploading(false);
    }
  }

  async function deleteGuideImage(id: string) {
    await fetch("/api/admin/clearance-guide-images", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setSelectedGuideIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await reload();
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/admin/clearance-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructionText,
          guideImageIds: Array.from(selectedGuideIds),
        }),
      });
      await reload();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="space-y-8">
      <PageHeader title="Clearance config" />

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Instruction text</h2>
        <p className="mb-2 text-sm text-muted">
          This message asks users to upload machine clearance photos from different angles.
        </p>
        <Textarea
          rows={5}
          value={instructionText}
          onChange={(e) => setInstructionText(e.target.value)}
        />
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-ink">Guide images</h2>
        <p className="text-sm text-muted">
          Select example images that show acceptable machine clearance viewpoints.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="text-sm"
          />
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            className="w-auto"
          />
          <Button
            size="sm"
            onClick={uploadGuideImages}
            disabled={uploading || files.length === 0}
          >
            {uploading ? "Uploading..." : "Upload guide image(s)"}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {guideImages.map((img) => {
            const selected = selectedGuideIds.has(img.id);
            return (
              <div
                key={img.id}
                className={`rounded-card border p-1 ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleGuideImage(img.id)}
                  className="w-full text-left"
                  title={img.notes ?? ""}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="Clearance guide" className="h-28 w-full rounded object-cover" />
                  <p className="mt-1 truncate px-1 text-xs text-muted">
                    {img.notes || img.id}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteGuideImage(img.id)}
                  className="mt-1 w-full rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
        {guideImages.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No guide images uploaded yet.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Preview</h2>
        <p className="whitespace-pre-wrap rounded border border-dashed border-border p-3 text-sm text-ink">
          {instructionText}
        </p>
        <p className="mt-2 text-sm text-muted">
          Selected guide images: {selectedCount}
        </p>
      </Card>

      <Button
        onClick={save}
        disabled={saving || !instructionText.trim()}
      >
        {saving ? "Saving..." : "Save clearance config"}
      </Button>
    </div>
  );
}
