"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActionSafetyLevel, ExpectedInput, ExpectedInputType } from "@/lib/types/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

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

export default function AdminEditActionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const actionId = decodeURIComponent(params.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
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

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/admin/actions/${encodeURIComponent(actionId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ActionRow & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load action.");
        }

        const expected = payload.expectedInput;
        setForm({
          title: payload.title ?? "",
          instructions: payload.instructions ?? "",
          expectedType: (expected?.type ?? "text") as ExpectedInputType,
          expectedUnit: expected?.unit ?? "",
          expectedMin: expected?.range?.min != null ? String(expected.range.min) : "",
          expectedMax: expected?.range?.max != null ? String(expected.range.max) : "",
          expectedOptions: expected?.options?.join(", ") ?? "",
          safetyLevel: (payload.safetyLevel as ActionSafetyLevel) || "safe",
          appliesToModels: Array.isArray(payload.appliesToModels)
            ? payload.appliesToModels.join(", ")
            : "",
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load action.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [actionId]);

  async function handleSave(e: React.FormEvent): Promise<void> {
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
      const response = await fetch(`/api/admin/actions/${encodeURIComponent(actionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save action.");
      }

      router.push("/admin/actions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save action.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (deleting) return;
    if (!confirm(`Delete action "${actionId}"? This cannot be undone.`)) return;

    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/actions/${encodeURIComponent(actionId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete action.");
      }
      router.push("/admin/actions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete action.");
      setDeleting(false);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Edit action" />

      <div className="max-w-3xl rounded-card border border-border bg-surface p-6 shadow-card">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <form onSubmit={handleSave} className="space-y-4">
          <Input type="text" value={actionId} disabled />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="text"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
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

            <Input
              type="text"
              placeholder="Applies to models (comma-separated)"
              value={form.appliesToModels}
              onChange={(e) => setForm((prev) => ({ ...prev, appliesToModels: e.target.value }))}
            />

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

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? "Deleting..." : "Delete action"}
            </Button>

            <div className="flex justify-end gap-2">
              <Link
                href="/admin/actions"
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
