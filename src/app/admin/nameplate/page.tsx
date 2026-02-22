"use client";

import { useEffect, useMemo, useState } from "react";

type GuideImage = {
  id: string;
  url: string;
  notes: string | null;
  selected: boolean;
};

type NameplateConfigPayload = {
  instructionText: string;
  guideImageIds: string[];
  guideImages: GuideImage[];
};

export default function AdminNameplateConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instructionText, setInstructionText] = useState("");
  const [guideImages, setGuideImages] = useState<GuideImage[]>([]);
  const [selectedGuideIds, setSelectedGuideIds] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");

  async function reload() {
    const res = await fetch("/api/admin/nameplate-config");
    const data = await res.json() as NameplateConfigPayload;
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
      await fetch("/api/admin/nameplate-guide-images", {
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
    await fetch("/api/admin/nameplate-guide-images", {
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
      await fetch("/api/admin/nameplate-config", {
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
      <h1 className="text-2xl font-bold">Nameplate config</h1>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-lg font-semibold">Instruction text</h2>
        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
          This is the first message users see before diagnostics begin.
        </p>
        <textarea
          rows={5}
          value={instructionText}
          onChange={(e) => setInstructionText(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
        />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-2 text-lg font-semibold">Guide images</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select images that show where the name plate is and what it looks like.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="text-sm"
          />
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes"
            className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
          <button
            type="button"
            onClick={uploadGuideImages}
            disabled={uploading || files.length === 0}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload guide image(s)"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {guideImages.map((img) => {
            const selected = selectedGuideIds.has(img.id);
            return (
              <div
                key={img.id}
                className={`rounded-lg border p-1 ${
                  selected
                    ? "border-blue-500 ring-2 ring-blue-300 dark:ring-blue-700"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleGuideImage(img.id)}
                  className="w-full text-left"
                  title={img.notes ?? ""}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="Nameplate guide" className="h-28 w-full rounded object-cover" />
                  <p className="mt-1 truncate px-1 text-xs text-gray-500 dark:text-gray-400">
                    {img.notes || img.id}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteGuideImage(img.id)}
                  className="mt-1 w-full rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
        {guideImages.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            No guide images uploaded yet.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-lg font-semibold">Preview</h2>
        <p className="whitespace-pre-wrap rounded border border-dashed border-gray-300 p-3 text-sm dark:border-gray-600">
          {instructionText}
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Selected guide images: {selectedCount}
        </p>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving || !instructionText.trim()}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save nameplate config"}
      </button>
    </div>
  );
}
