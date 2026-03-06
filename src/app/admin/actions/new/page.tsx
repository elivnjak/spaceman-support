"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionSafetyLevel, ExpectedInput, ExpectedInputType } from "@/lib/types/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const EXPECTED_INPUT_TYPES: ExpectedInputType[] = ["photo", "number", "text", "boolean", "enum"];
const SAFETY_LEVELS: ActionSafetyLevel[] = ["safe", "caution", "technician_only"];

function toSlug(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export default function AdminNewActionPage() {
  const router = useRouter();
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
  const [error, setError] = useState<string | null>(null);

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
      return { type: "enum", options };
    }
    return { type: "text" };
  };

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (saving) return;

    const expectedInput = buildExpectedInput();
    if (expectedInput?.type === "enum" && (expectedInput.options?.length ?? 0) < 2) {
      setError("Enum expected input requires at least 2 options.");
      return;
    }

    const appliesToModels = form.appliesToModels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id.trim() || toSlug(form.title),
          title: form.title.trim(),
          instructions: form.instructions.trim(),
          expectedInput:
            expectedInput?.type === "text" &&
            !expectedInput.unit &&
            !expectedInput.range &&
            !(expectedInput.options?.length)
              ? null
              : expectedInput,
          safetyLevel: form.safetyLevel,
          appliesToModels: appliesToModels.length ? appliesToModels : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? "Unable to save action.");
      }
      router.push(`/admin/actions/${encodeURIComponent(payload.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save action.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Add action" />

      <div className="max-w-3xl rounded-card border border-border bg-surface p-6 shadow-card">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="text"
              placeholder="ID (slug, optional)"
              value={form.id}
              onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
            />
            <Input
              type="text"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Instructions</label>
            <Textarea
              rows={4}
              className="mt-1"
              placeholder="What the user should do..."
              value={form.instructions}
              onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-ink">Expected input type</label>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                value={form.expectedType}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, expectedType: e.target.value as ExpectedInputType }))
                }
              >
                {EXPECTED_INPUT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink">Safety level</label>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
                value={form.safetyLevel}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, safetyLevel: e.target.value as ActionSafetyLevel }))
                }
              >
                {SAFETY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>

            {form.expectedType === "number" && (
              <>
                <Input
                  type="text"
                  placeholder="Unit (e.g. C, servings)"
                  value={form.expectedUnit}
                  onChange={(e) => setForm((prev) => ({ ...prev, expectedUnit: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    placeholder="Range min"
                    value={form.expectedMin}
                    onChange={(e) => setForm((prev) => ({ ...prev, expectedMin: e.target.value }))}
                  />
                  <Input
                    type="number"
                    placeholder="Range max"
                    value={form.expectedMax}
                    onChange={(e) => setForm((prev) => ({ ...prev, expectedMax: e.target.value }))}
                  />
                </div>
              </>
            )}

            {form.expectedType === "enum" && (
              <Input
                type="text"
                placeholder="Options (comma-separated)"
                value={form.expectedOptions}
                onChange={(e) => setForm((prev) => ({ ...prev, expectedOptions: e.target.value }))}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">
              Applies to models (comma-separated, empty = all)
            </label>
            <Input
              type="text"
              className="mt-1"
              placeholder="Spaceman 500, Spaceman 600"
              value={form.appliesToModels}
              onChange={(e) => setForm((prev) => ({ ...prev, appliesToModels: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Link
              href="/admin/actions"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-page"
            >
              Cancel
            </Link>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create action"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
