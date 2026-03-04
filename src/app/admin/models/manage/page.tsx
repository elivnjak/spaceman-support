"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Input";

export default function AdminModelsManagePage() {
  const [modelNumber, setModelNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Supported models"
        description="Add single models or bulk import in one dedicated page."
      />

      <div>
        <Link href="/admin/models" className="text-sm text-primary hover:underline">
          View current supported models
        </Link>
      </div>

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
          <Button onClick={addSingle} disabled={submitting || !modelNumber.trim()}>
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
    </div>
  );
}
