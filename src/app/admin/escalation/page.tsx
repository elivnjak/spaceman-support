"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

type EscalationConfigPayload = {
  generalEscalationMessage: string;
  frustrationEscalationIntentMessage: string;
  noModelNumberEscalationMessage: string;
  telegramEscalationNotificationText: string;
};

export default function AdminEscalationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<"success" | "error" | null>(
    null
  );
  const [saveDetail, setSaveDetail] = useState<string | null>(null);
  const [generalEscalationMessage, setGeneralEscalationMessage] = useState("");
  const [frustrationEscalationIntentMessage, setFrustrationEscalationIntentMessage] =
    useState("");
  const [noModelNumberEscalationMessage, setNoModelNumberEscalationMessage] =
    useState("");
  const [telegramEscalationNotificationText, setTelegramEscalationNotificationText] =
    useState("");

  async function reload() {
    const res = await fetch("/api/admin/escalation-config", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load escalation config (${res.status})`);
    }
    const data = (await res.json()) as EscalationConfigPayload;
    setGeneralEscalationMessage(data.generalEscalationMessage ?? "");
    setFrustrationEscalationIntentMessage(data.frustrationEscalationIntentMessage ?? "");
    setNoModelNumberEscalationMessage(data.noModelNumberEscalationMessage ?? "");
    setTelegramEscalationNotificationText(data.telegramEscalationNotificationText ?? "");
  }

  useEffect(() => {
    reload()
      .catch((e) => {
        setSaveMessage("error");
        setSaveDetail(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaveMessage(null);
    setSaveDetail(null);
    try {
      const res = await fetch("/api/admin/escalation-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generalEscalationMessage,
          frustrationEscalationIntentMessage,
          noModelNumberEscalationMessage,
          telegramEscalationNotificationText,
          updatedBy: "admin",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveMessage("error");
        setSaveDetail(data.error ?? "Failed to save escalation config.");
        return;
      }
      await reload();
      setSaveMessage("success");
      setSaveDetail("Escalation config saved.");
    } catch (e) {
      setSaveMessage("error");
      setSaveDetail(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Escalation"
        description="Manage all escalation text in one place."
      />

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-ink">
          General escalation message
        </h2>
        <p className="mb-3 text-sm text-muted">
          Shown for system-driven escalations (for example: safety/trigger,
          maximum turns, no progress, or unresolved triage).
        </p>
        <Textarea
          rows={4}
          value={generalEscalationMessage}
          onChange={(e) => setGeneralEscalationMessage(e.target.value)}
        />
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Frustration escalation message
        </h2>
        <p className="mb-3 text-sm text-muted">
          Shown when the user requests a human or escalation is triggered from
          frustration handling.
        </p>
        <Textarea
          rows={4}
          value={frustrationEscalationIntentMessage}
          onChange={(e) => setFrustrationEscalationIntentMessage(e.target.value)}
        />
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-ink">
          No model/serial escalation message
        </h2>
        <p className="mb-3 text-sm text-muted">
          Shown when a user cannot provide machine model/serial details and the
          chat escalates.
        </p>
        <Textarea
          rows={4}
          value={noModelNumberEscalationMessage}
          onChange={(e) => setNoModelNumberEscalationMessage(e.target.value)}
        />
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-ink">
          Telegram escalation notification text
        </h2>
        <p className="mb-3 text-sm text-muted">
          Lead line for Telegram escalation alerts. You can use placeholders:
          {" "}
          <code>
            {`{{machineModel}}, {{customerName}}, {{productType}}, {{serialNumber}}, {{sessionId}}, {{escalationReason}}`}
          </code>
          .
        </p>
        <Textarea
          rows={4}
          value={telegramEscalationNotificationText}
          onChange={(e) => setTelegramEscalationNotificationText(e.target.value)}
        />
      </Card>

      {saveMessage ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            saveMessage === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {saveDetail ?? (saveMessage === "success" ? "Saved." : "Failed to save.")}
        </p>
      ) : null}

      <Button
        onClick={save}
        disabled={
          saving ||
          !generalEscalationMessage.trim() ||
          !frustrationEscalationIntentMessage.trim() ||
          !noModelNumberEscalationMessage.trim() ||
          !telegramEscalationNotificationText.trim()
        }
      >
        {saving ? "Saving..." : "Save escalation config"}
      </Button>
    </div>
  );
}
