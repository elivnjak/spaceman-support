"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
      <h1 className="mb-6 text-2xl font-bold">Labels</h1>
      <form onSubmit={handleSubmit} className="mb-8 flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="ID (slug)"
          className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          value={form.id}
          onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
        />
        <input
          type="text"
          placeholder="Display name"
          className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          value={form.displayName}
          onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
          required
        />
        <input
          type="text"
          placeholder="Description"
          className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      <ul className="space-y-2">
        {list.map((l) => (
          <li
            key={l.id}
            className="flex items-center justify-between rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div>
              <span className="font-medium">{l.displayName}</span>
              <span className="ml-2 text-sm text-gray-500">({l.id})</span>
              {l.description && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {l.description}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
