"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Input";

type SupportedModel = {
  id: string;
  modelNumber: string;
  displayName: string | null;
};

export default function AdminModelsPage() {
  const [models, setModels] = useState<SupportedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelNumber, setModelNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    const res = await fetch("/api/admin/supported-models");
    const data = await res.json();
    setModels(data);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function addSingle() {
    if (!modelNumber.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/admin/supported-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelNumber: modelNumber.trim(),
          displayName: displayName.trim() || null,
        }),
      });
      setModelNumber("");
      setDisplayName("");
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function addBulk() {
    const parsed = bulkInput
      .split(/[,\n]/g)
      .map((value) => value.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;
    setSubmitting(true);
    try {
      await fetch("/api/admin/supported-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: parsed }),
      });
      setBulkInput("");
      await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    await fetch("/api/admin/supported-models", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await reload();
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="space-y-8">
      <PageHeader title="Supported models" />

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-ink">Add model</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            type="text"
            value={modelNumber}
            onChange={(e) => setModelNumber(e.target.value)}
            placeholder="Model number (e.g. 6210-C)"
          />
          <Input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
          />
          <Button
            onClick={addSingle}
            disabled={submitting || !modelNumber.trim()}
          >
            Add model
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-ink">Bulk import</h2>
        <p className="mb-2 text-sm text-muted">
          Paste model numbers separated by commas or new lines.
        </p>
        <Textarea
          value={bulkInput}
          onChange={(e) => setBulkInput(e.target.value)}
          rows={5}
          placeholder={"6210-C, 6235A\n6350-C"}
        />
        <Button
          onClick={addBulk}
          disabled={submitting || !bulkInput.trim()}
          className="mt-3"
        >
          Import models
        </Button>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Current supported models</h2>
          <p className="text-sm text-muted">{models.length} total</p>
        </div>
        <div className="space-y-2">
          {[...models]
            .sort((a, b) => a.modelNumber.localeCompare(b.modelNumber))
            .map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div>
                <p className="font-mono text-sm text-ink">{model.modelNumber}</p>
                {model.displayName ? (
                  <p className="text-xs text-muted">{model.displayName}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => remove(model.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
          {models.length === 0 ? (
            <p className="text-sm text-muted">No supported models configured yet.</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
