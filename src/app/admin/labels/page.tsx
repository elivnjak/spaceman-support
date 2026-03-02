"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Label = { id: string; displayName: string; description: string | null };

export default function AdminLabelsPage() {
  const [list, setList] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ id: "", displayName: "", description: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/labels")
      .then((r) => r.json())
      .then(setList)
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || form.displayName.toLowerCase().replace(/\s+/g, "_"),
          displayName: form.displayName,
          description: form.description || undefined,
        }),
      });
      const created = await res.json();
      if (res.ok) {
        setList((prev) => {
          const existing = prev.findIndex((l) => l.id === created.id);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = created;
            return next;
          }
          return [...prev, created];
        });
        setForm({ id: "", displayName: "", description: "" });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <PageHeader title="Labels" />
      <form onSubmit={handleSubmit} className="mb-8 flex flex-wrap gap-4">
        <Input
          type="text"
          placeholder="ID (slug)"
          value={form.id}
          onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
          className="w-auto"
        />
        <Input
          type="text"
          placeholder="Display name"
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          required
          className="w-auto"
        />
        <Input
          type="text"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="w-auto"
        />
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      <ul className="space-y-2">
        {list.map((l) => (
          <Card
            key={l.id}
            padding="sm"
            className="flex items-center justify-between"
          >
            <div>
              <span className="font-medium">{l.displayName}</span>
              <span className="ml-2 text-sm text-muted">({l.id})</span>
              {l.description && (
                <p className="mt-1 text-sm text-muted">
                  {l.description}
                </p>
              )}
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
