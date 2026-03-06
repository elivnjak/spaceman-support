"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

type Label = {
  id: string;
  displayName: string;
  description: string | null;
};

export default function AdminEditLabelPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const labelId = decodeURIComponent(params.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", description: "" });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/admin/labels/${encodeURIComponent(labelId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Label & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load label.");
        }
        setForm({
          displayName: payload.displayName ?? "",
          description: payload.description ?? "",
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load label.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [labelId]);

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/labels/${encodeURIComponent(labelId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          description: form.description.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save label.");
      }
      router.push("/admin/labels");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save label.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    if (!confirm(`Delete label "${labelId}"? This cannot be undone.`)) return;

    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/labels/${encodeURIComponent(labelId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete label.");
      }
      router.push("/admin/labels");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete label.");
      setDeleting(false);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Edit label" />

      <div className="max-w-2xl rounded-card border border-border bg-surface p-6 shadow-card">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <Input type="text" value={labelId} disabled />
          <Input
            type="text"
            placeholder="Display name"
            value={form.displayName}
            onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
            required
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Description (optional)"
            rows={4}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none ring-primary transition focus:ring-2"
          />

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? "Deleting..." : "Delete label"}
            </Button>

            <div className="flex items-center gap-2">
              <Link
                href="/admin/labels"
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-page"
              >
                Cancel
              </Link>
              <Button type="submit" disabled={saving || deleting}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
