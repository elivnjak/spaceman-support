"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

function toSlug(input: string): string {
  return input.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export default function AdminNewLabelPage() {
  const router = useRouter();
  const [form, setForm] = useState({ id: "", displayName: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);
    try {
      const id = form.id.trim() || toSlug(form.displayName.trim());
      const response = await fetch("/api/admin/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          displayName: form.displayName.trim(),
          description: form.description.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? "Failed to create label.");
      }

      router.push(`/admin/labels/${encodeURIComponent(payload.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create label.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Add label" />

      <div className="max-w-2xl rounded-card border border-border bg-surface p-6 shadow-card">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            type="text"
            placeholder="Display name"
            value={form.displayName}
            onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
            required
          />
          <Input
            type="text"
            placeholder="ID (slug, optional)"
            value={form.id}
            onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder="Description (optional)"
            rows={4}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none ring-primary transition focus:ring-2"
          />

          <div className="flex items-center justify-end gap-2">
            <Link
              href="/admin/labels"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-page"
            >
              Cancel
            </Link>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create label"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
