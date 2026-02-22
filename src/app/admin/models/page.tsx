"use client";

import { useEffect, useState } from "react";

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
      <h1 className="text-2xl font-bold">Supported models</h1>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold">Add model</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="text"
            value={modelNumber}
            onChange={(e) => setModelNumber(e.target.value)}
            placeholder="Model number (e.g. 6210-C)"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
          />
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
          />
          <button
            type="button"
            onClick={addSingle}
            disabled={submitting || !modelNumber.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add model
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold">Bulk import</h2>
        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
          Paste model numbers separated by commas or new lines.
        </p>
        <textarea
          value={bulkInput}
          onChange={(e) => setBulkInput(e.target.value)}
          rows={5}
          className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
          placeholder={"6210-C, 6235A\n6350-C"}
        />
        <button
          type="button"
          onClick={addBulk}
          disabled={submitting || !bulkInput.trim()}
          className="mt-3 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Import models
        </button>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Current supported models</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{models.length} total</p>
        </div>
        <div className="space-y-2">
          {[...models]
            .sort((a, b) => a.modelNumber.localeCompare(b.modelNumber))
            .map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 dark:border-gray-700"
            >
              <div>
                <p className="font-mono text-sm">{model.modelNumber}</p>
                {model.displayName ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{model.displayName}</p>
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
            <p className="text-sm text-gray-500 dark:text-gray-400">No supported models configured yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
