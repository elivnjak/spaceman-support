"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ExpectedInput, ExpectedInputType, ActionSafetyLevel } from "@/lib/types/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

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
  const [formError, setFormError] = useState("");

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
    setFormError("");
    try {
      const expectedInput = buildExpectedInput();
      if (expectedInput?.type === "enum" && (expectedInput.options?.length ?? 0) < 2) {
        setFormError("Enum expected input requires at least 2 options.");
        return;
      }
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
      } else {
        setFormError(created?.error || "Unable to save action.");
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
      <PageHeader
        title="Action Catalog"
        actions={
          <Link href="/admin" className="text-primary hover:underline">
            ← Dashboard
          </Link>
        }
      />

      {deleteError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {deleteError}
        </div>
      )}

      <Card className="mb-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h2 className="text-lg font-medium">Add or update action</h2>
          {formError && (
            <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {formError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="text"
              placeholder="ID (slug, e.g. photo_dispense_front)"
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            />
            <Input
              type="text"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Instructions (step-by-step)</label>
            <Textarea
              rows={3}
              className="mt-1"
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
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
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
                  <Input
                    type="text"
                    className="mt-1"
                    value={form.expectedUnit}
                    onChange={(e) => setForm((f) => ({ ...f, expectedUnit: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">Range min</label>
                  <Input
                    type="number"
                    className="mt-1"
                    value={form.expectedMin}
                    onChange={(e) => setForm((f) => ({ ...f, expectedMin: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">Range max</label>
                  <Input
                    type="number"
                    className="mt-1"
                    value={form.expectedMax}
                    onChange={(e) => setForm((f) => ({ ...f, expectedMax: e.target.value }))}
                  />
                </div>
              </>
            )}
            {form.expectedType === "enum" && (
              <div>
                <label className="block text-sm font-medium">Options (comma-separated)</label>
                <Input
                  type="text"
                  className="mt-1"
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
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
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
              <Input
                type="text"
                className="mt-1"
                placeholder="Spaceman 500, Spaceman 600"
                value={form.appliesToModels}
                onChange={(e) => setForm((f) => ({ ...f, appliesToModels: e.target.value }))}
              />
            </div>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </Card>

      <ul className="space-y-2">
        {list.map((a) => (
          <Card
            key={a.id}
            padding="sm"
            className="flex items-center justify-between"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium">{a.title}</span>
              <span className="ml-2 text-sm text-muted">({a.id})</span>
              <Badge className="ml-2">{a.safetyLevel}</Badge>
              {a.expectedInput && (
                <span className="ml-2 text-xs text-muted">
                  → {a.expectedInput.type}
                  {a.expectedInput.unit ? ` ${a.expectedInput.unit}` : ""}
                </span>
              )}
              <p className="mt-1 truncate text-sm text-muted">{a.instructions}</p>
            </div>
            <div className="ml-4 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fillForm(a)}
              >
                Edit
              </Button>
              {deleteId === a.id ? (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(a.id)}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeleteId(null)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteId(a.id)}
                  className="rounded-lg border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
