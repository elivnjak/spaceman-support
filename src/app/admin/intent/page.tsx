"use client";

import { useEffect, useMemo, useState } from "react";
import type { FieldMeta, IntentManifest, IntentManifestMeta } from "@/lib/intent/types";
import { PageHeader } from "@/components/ui/PageHeader";

type IntentManifestApiResponse = {
  manifest: IntentManifest;
  metadata: IntentManifestMeta;
  overriddenFields: string[];
};

const ESCALATION_PAGE_MANAGED_FIELDS = new Set([
  "communication.escalationTone",
  "communication.telegramEscalationNotificationText",
  "communication.noModelNumberEscalationMessage",
  "frustrationHandling.escalationIntentMessage",
]);

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

export default function AdminIntentManifestPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<"success" | "error" | null>(
    null
  );
  const [manifest, setManifest] = useState<IntentManifest | null>(null);
  const [metadata, setMetadata] = useState<IntentManifestMeta | null>(null);
  const [overriddenFields, setOverriddenFields] = useState<string[]>([]);

  async function reload() {
    setError(null);
    const res = await fetch("/api/admin/intent-manifest", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load intent manifest (${res.status})`);
    }
    const data = (await res.json()) as IntentManifestApiResponse;
    setManifest(data.manifest);
    setMetadata(data.metadata);
    setOverriddenFields(data.overriddenFields ?? []);
  }

  useEffect(() => {
    reload()
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  const domainKeys = useMemo(
    () =>
      metadata ? (Object.keys(metadata) as Array<keyof IntentManifestMeta>) : [],
    [metadata]
  );

  function updateField(
    domain: keyof IntentManifest,
    field: string,
    value: unknown
  ) {
    setManifest((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [domain]: {
          ...(prev[domain] as Record<string, unknown>),
          [field]: value,
        },
      } as IntentManifest;
    });
  }

  function resetField(domain: keyof IntentManifest, field: string) {
    if (!metadata) return;
    const fieldMeta = (metadata[domain] as Record<string, unknown>)[
      field
    ] as FieldMeta;
    updateField(domain, field, fieldMeta.default);
  }

  function buildOverridePayload(): Record<string, Record<string, unknown>> {
    if (!manifest || !metadata) return {};
    const payload: Record<string, Record<string, unknown>> = {};
    for (const domain of Object.keys(metadata) as Array<keyof IntentManifest>) {
      const domainMeta = metadata[domain] as Record<string, unknown>;
      const domainValues = manifest[domain] as Record<string, unknown>;
      for (const field of Object.keys(domainMeta)) {
        if (field === "_domain") continue;
        const fieldMeta = domainMeta[field] as FieldMeta;
        const value = domainValues[field];
        if (!isEqual(value, fieldMeta.default)) {
          if (!payload[domain]) payload[domain] = {};
          payload[domain][field] = value;
        }
      }
    }
    return payload;
  }

  async function save() {
    if (!manifest || !metadata) return;
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const override = buildOverridePayload();
      const res = await fetch("/api/admin/intent-manifest", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          override,
          updatedBy: "admin",
        }),
      });
      if (!res.ok) {
        const details = await res.text();
        setError(`Save failed: ${details}`);
        setSaveMessage("error");
        return;
      }
      setSaveMessage("success");
      await reload();
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaveMessage("error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading intent manifest...</p>;
  if (!manifest || !metadata) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-ink">Intent Manifest</h1>
        <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? "Failed to load manifest."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intent Manifest"
        description="Tune organizational intent values used by the diagnostic chatbot. Every field includes an explanation of what it controls and the impact of changing it. Escalation message text is managed under Admin > Escalation."
        className="mb-0"
      />

      {domainKeys.map((domainKey) => {
        const domainMeta = metadata[domainKey];
        const domainValues = manifest[domainKey] as Record<string, unknown>;
        const fields = Object.keys(domainMeta).filter(
          (key) =>
            key !== "_domain" &&
            !ESCALATION_PAGE_MANAGED_FIELDS.has(`${String(domainKey)}.${key}`)
        );
        return (
          <details
            key={String(domainKey)}
            open
            className="rounded-lg border border-border bg-surface p-4"
          >
            <summary className="cursor-pointer text-lg font-semibold">
              {domainMeta._domain.label}
            </summary>
            <p className="mt-2 text-sm text-muted">
              {domainMeta._domain.description}
            </p>

            <div className="mt-4 space-y-5">
              {fields.map((fieldKey) => {
                const fieldMeta = (domainMeta as Record<string, unknown>)[
                  fieldKey
                ] as FieldMeta;
                const value = domainValues[fieldKey];
                const path = `${String(domainKey)}.${fieldKey}`;
                const isOverridden = overriddenFields.includes(path);
                const isObjectLike =
                  typeof value === "object" && value !== null;

                return (
                  <div
                    key={path}
                    className={`rounded border p-3 ${
                      isOverridden
                        ? "border-primary/30 bg-primary-light"
                        : "border-border"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label className="text-sm font-semibold">
                        {fieldMeta.label}
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          resetField(domainKey as keyof IntentManifest, fieldKey)
                        }
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-aqua/30"
                      >
                        Reset to default
                      </button>
                    </div>

                    <p className="text-xs text-muted">
                      {fieldMeta.description}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      <span className="font-medium">Impact:</span> {fieldMeta.impact}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      <span className="font-medium">Default:</span>{" "}
                      <code>{safeJsonStringify(fieldMeta.default)}</code>
                    </p>

                    <div className="mt-3">
                      {typeof value === "boolean" ? (
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) =>
                              updateField(
                                domainKey as keyof IntentManifest,
                                fieldKey,
                                e.target.checked
                              )
                            }
                          />
                          <span>{value ? "Enabled" : "Disabled"}</span>
                        </label>
                      ) : typeof value === "number" ? (
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            value={Number.isFinite(value) ? value : 0}
                            min={fieldMeta.range?.min}
                            max={fieldMeta.range?.max}
                            step={fieldMeta.range?.step ?? 0.01}
                            onChange={(e) =>
                              updateField(
                                domainKey as keyof IntentManifest,
                                fieldKey,
                                Number(e.target.value)
                              )
                            }
                            className="w-44 rounded border border-border px-2 py-1 text-sm"
                          />
                          {fieldMeta.range ? (
                            <span className="text-xs text-muted">
                              Range: {fieldMeta.range.min} - {fieldMeta.range.max}
                            </span>
                          ) : null}
                        </div>
                      ) : typeof value === "string" &&
                        fieldMeta.options &&
                        fieldMeta.options.length > 0 ? (
                        <select
                          value={value}
                          onChange={(e) =>
                            updateField(
                              domainKey as keyof IntentManifest,
                              fieldKey,
                              e.target.value
                            )
                          }
                          className="w-full max-w-md rounded border border-border px-2 py-1 text-sm"
                        >
                          {fieldMeta.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : isObjectLike ? (
                        <textarea
                          rows={8}
                          value={safeJsonStringify(value)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              updateField(
                                domainKey as keyof IntentManifest,
                                fieldKey,
                                parsed
                              );
                            } catch {
                              // keep editing experience permissive; parse validation happens on save
                            }
                          }}
                          className="w-full rounded border border-border px-2 py-1 font-mono text-xs"
                        />
                      ) : (
                        <input
                          type="text"
                          value={String(value ?? "")}
                          onChange={(e) =>
                            updateField(
                              domainKey as keyof IntentManifest,
                              fieldKey,
                              e.target.value
                            )
                          }
                          className="w-full max-w-2xl rounded border border-border px-2 py-1 text-sm"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {saveMessage === "success" ? (
        <p className="rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Intent manifest saved.
        </p>
      ) : null}
      {saveMessage === "error" ? (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Failed to save intent manifest.
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save intent manifest"}
      </button>
    </div>
  );
}
