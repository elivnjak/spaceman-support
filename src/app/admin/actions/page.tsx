"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ExpectedInput, ExpectedInputType, ActionSafetyLevel } from "@/lib/types/actions";

type ActionRow = {
  id: string;
  title: string;
  instructions: string;
  expectedInput: ExpectedInput | null;
  safetyLevel: string;
  appliesToModels: string[] | null;
};

const EXPECTED_INPUT_TYPES: ExpectedInputType[] = ["photo", "number", "text", "boolean", "enum"];
const SAFETY_LEVELS: ActionSafetyLevel[] = ["safe", "caution", "technician_only"];

const emptyExpected = (): ExpectedInput => ({ type: "text" });

export default function AdminActionsPage() {
  const [list, setList] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    id: "",
    title: "",
    instructions: "",
    expectedType: "text" as ExpectedInputType,
    expectedUnit: "",
    expectedMin: "",
    expectedMax: "",
    expectedOptions: "",
    safetyLevel: "safe" as ActionSafetyLevel,
    appliesToModels: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    fetch("/api/admin/actions")
      .then((r) => r.json())
      .then(setList)
      .finally(() => setLoading(false));
  }, []);

  const buildExpectedInput = (): ExpectedInput | null => {
    const t = form.expectedType;
    if (t === "photo") return { type: "photo" };
    if (t === "boolean") return { type: "boolean" };
    if (t === "text") return { type: "text" };
    if (t === "number") {
      const min = form.expectedMin ? Number(form.expectedMin) : undefined;
      const max = form.expectedMax ? Number(form.expectedMax) : undefined;
      return {
        type: "number",
        unit: form.expectedUnit || undefined,
        range: min != null || max != null ? { min: min ?? 0, max: max ?? 100 } : undefined,
      };
    }
    if (t === "enum") {
      const options = form.expectedOptions
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return options.length ? { type: "enum", options } : { type: "enum", options: [] };
    }
    return { type: "text" };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setDeleteError("");
    try {
      const expectedInput = buildExpectedInput();
      const appliesToModels = form.appliesToModels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || form.title.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
          title: form.title,
          instructions: form.instructions,
          expectedInput: expectedInput?.type === "text" && !expectedInput.unit && !expectedInput.range && !(expectedInput.options?.length) ? null : expectedInput,
          safetyLevel: form.safetyLevel,
          appliesToModels: appliesToModels.length ? appliesToModels : null,
        }),
      });
      const created = await res.json();
      if (res.ok) {
        setList((prev) => {
          const idx = prev.findIndex((a) => a.id === created.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = created;
            return next;
          }
          return [...prev, created];
        });
        setForm({
          id: "",
          title: "",
          instructions: "",
          expectedType: "text",
          expectedUnit: "",
          expectedMin: "",
          expectedMax: "",
          expectedOptions: "",
          safetyLevel: "safe",
          appliesToModels: "",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteError("");
    const res = await fetch(`/api/admin/actions/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setList((prev) => prev.filter((a) => a.id !== id));
      setDeleteId(null);
    } else {
      setDeleteError(data.error || "Delete failed");
    }
  };

  const fillForm = (a: ActionRow) => {
    const ei = a.expectedInput;
    setForm({
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      expectedType: (ei?.type ?? "text") as ExpectedInputType,
      expectedUnit: ei?.unit ?? "",
      expectedMin: ei?.range?.min != null ? String(ei.range.min) : "",
      expectedMax: ei?.range?.max != null ? String(ei.range.max) : "",
      expectedOptions: ei?.options?.join(", ") ?? "",
      safetyLevel: (a.safetyLevel as ActionSafetyLevel) || "safe",
      appliesToModels: Array.isArray(a.appliesToModels) ? a.appliesToModels.join(", ") : "",
    });
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Action Catalog</h1>
        <Link href="/admin" className="text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>

      {deleteError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {deleteError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mb-8 space-y-4 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-medium">Add or update action</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <input
            type="text"
            placeholder="ID (slug, e.g. photo_dispense_front)"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Title"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Instructions (step-by-step)</label>
          <textarea
            rows={3}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            placeholder="What the user should do..."
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Expected input type</label>
            <select
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              value={form.expectedType}
              onChange={(e) => setForm((f) => ({ ...f, expectedType: e.target.value as ExpectedInputType }))}
            >
              {EXPECTED_INPUT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {form.expectedType === "number" && (
            <>
              <div>
                <label className="block text-sm font-medium">Unit (e.g. C, servings)</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                  value={form.expectedUnit}
                  onChange={(e) => setForm((f) => ({ ...f, expectedUnit: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Range min</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                  value={form.expectedMin}
                  onChange={(e) => setForm((f) => ({ ...f, expectedMin: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Range max</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                  value={form.expectedMax}
                  onChange={(e) => setForm((f) => ({ ...f, expectedMax: e.target.value }))}
                />
              </div>
            </>
          )}
          {form.expectedType === "enum" && (
            <div>
              <label className="block text-sm font-medium">Options (comma-separated)</label>
              <input
                type="text"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                placeholder="Option 1, Option 2, Option 3"
                value={form.expectedOptions}
                onChange={(e) => setForm((f) => ({ ...f, expectedOptions: e.target.value }))}
              />
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">Safety level</label>
            <select
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              value={form.safetyLevel}
              onChange={(e) => setForm((f) => ({ ...f, safetyLevel: e.target.value as ActionSafetyLevel }))}
            >
              {SAFETY_LEVELS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Applies to models (comma-separated, empty = all)</label>
            <input
              type="text"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              placeholder="Spaceman 500, Spaceman 600"
              value={form.appliesToModels}
              onChange={(e) => setForm((f) => ({ ...f, appliesToModels: e.target.value }))}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <ul className="space-y-2">
        {list.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium">{a.title}</span>
              <span className="ml-2 text-sm text-gray-500">({a.id})</span>
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">
                {a.safetyLevel}
              </span>
              {a.expectedInput && (
                <span className="ml-2 text-xs text-gray-500">
                  → {a.expectedInput.type}
                  {a.expectedInput.unit ? ` ${a.expectedInput.unit}` : ""}
                </span>
              )}
              <p className="mt-1 truncate text-sm text-gray-600 dark:text-gray-400">{a.instructions}</p>
            </div>
            <div className="ml-4 flex gap-2">
              <button
                type="button"
                onClick={() => fillForm(a)}
                className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                Edit
              </button>
              {deleteId === a.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleDelete(a.id)}
                    className="rounded bg-red-600 px-2 py-1 text-sm text-white hover:bg-red-700"
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(null)}
                    className="rounded border px-2 py-1 text-sm"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteId(a.id)}
                  className="rounded border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
