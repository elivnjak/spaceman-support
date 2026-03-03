"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";

type DiagnosisModePayload = {
  enabled: boolean;
};

export default function AdminDiagnosisModePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saveMessage, setSaveMessage] = useState<"success" | "error" | null>(null);

  async function reload() {
    const res = await fetch("/api/admin/diagnosis-mode-config", { cache: "no-store" });
    const data = (await res.json()) as DiagnosisModePayload;
    setEnabled(data.enabled ?? true);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/diagnosis-mode-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setSaveMessage("error");
        return;
      }
      await reload();
      setSaveMessage("success");
      setTimeout(() => setSaveMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="space-y-8">
      <PageHeader title="Diagnosis mode" />

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Status</h2>
        <p className="mb-3 text-sm text-muted">
          Logged-in users always run full diagnostics. This toggle controls only public chat.
          When disabled, public chat collects intake details (welcome info, issue, nameplate, and
          clearance photos) and then auto-escalates to a technician.
        </p>
        <div className="flex items-center gap-3">
          <Toggle enabled={enabled} onChange={setEnabled} />
          <span className={`font-medium ${enabled ? "text-emerald-700" : "text-muted"}`}>
            {enabled
              ? "Diagnosis on (public users get full diagnostics)"
              : "Diagnosis off (public users auto-escalate after intake)"}
          </span>
        </div>
      </Card>

      {saveMessage ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            saveMessage === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {saveMessage === "success" ? "Diagnosis mode saved." : "Failed to save diagnosis mode."}
        </p>
      ) : null}

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save diagnosis mode"}
      </Button>
    </div>
  );
}
