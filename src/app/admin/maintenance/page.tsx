"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";

type MaintenanceConfigPayload = {
  enabled: boolean;
  iconPath: string | null;
  iconUrl: string | null;
  title: string;
  description: string;
  phone: string;
  email: string;
};

export default function AdminMaintenancePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [saveMessage, setSaveMessage] = useState<"success" | "error" | null>(null);

  async function reload() {
    const res = await fetch("/api/admin/maintenance-config");
    const data = (await res.json()) as MaintenanceConfigPayload;
    setEnabled(data.enabled);
    setIconUrl(data.iconUrl);
    setTitle(data.title);
    setDescription(data.description);
    setPhone(data.phone);
    setEmail(data.email);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function uploadIcon() {
    if (!iconFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", iconFile);
      await fetch("/api/admin/maintenance-icon", {
        method: "POST",
        body: formData,
      });
      setIconFile(null);
      await reload();
    } finally {
      setUploading(false);
    }
  }

  async function deleteIcon() {
    await fetch("/api/admin/maintenance-icon", { method: "DELETE" });
    await reload();
  }

  async function save() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/admin/maintenance-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          title,
          description,
          phone,
          email,
        }),
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
      <PageHeader title="Maintenance mode" />

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Status</h2>
        <p className="mb-3 text-sm text-muted">
          When enabled, the chat is offline for public users. Logged-in admins can
          still use the chat.
        </p>
        <div className="flex items-center gap-3">
          <Toggle enabled={enabled} onChange={setEnabled} />
          <span
            className={`font-medium ${enabled ? "text-emerald-700" : "text-muted"}`}
          >
            {enabled ? "Maintenance on (chat offline for public)" : "Maintenance off"}
          </span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-ink">Icon</h2>
        <p className="mb-3 text-sm text-muted">
          Optional image shown on the maintenance page (e.g. logo or wrench).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <Button
            size="sm"
            onClick={uploadIcon}
            disabled={uploading || !iconFile}
          >
            {uploading ? "Uploading..." : "Upload icon"}
          </Button>
          {iconUrl && (
            <button
              type="button"
              onClick={deleteIcon}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              Remove icon
            </button>
          )}
        </div>
        {iconUrl && (
          <div className="mt-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={iconUrl}
              alt="Maintenance icon"
              className="h-24 w-24 rounded object-contain"
            />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Content</h2>
        <p className="mb-3 text-sm text-muted">
          Text and contact details shown on the maintenance page.
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Title</label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Chat Unavailable"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Description</label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Our support chat is currently undergoing maintenance."
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Phone</label>
            <Input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 234 567 8900"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="support@example.com"
            />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Preview</h2>
        <p className="mb-3 text-sm text-muted">
          How the maintenance page will look to public users.
        </p>
        <div className="flex justify-center rounded border border-dashed border-border bg-page p-8">
          <div className="w-full max-w-xs rounded-2xl border border-border bg-surface p-6 shadow-card">
            <div className="flex flex-col items-center gap-4 text-center">
              {iconUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={iconUrl}
                  alt=""
                  className="h-12 w-auto object-contain"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-page">
                  <svg
                    className="h-5 w-5 text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
              )}
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-ink">
                  {title || "Chat Unavailable"}
                </h3>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">
                  {description || "Our support chat is currently undergoing maintenance."}
                </p>
              </div>
              {(phone || email) && (
                <>
                  <div className="w-full border-t border-border" />
                  <div className="w-full space-y-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      Need help? Contact us
                    </p>
                    {phone && (
                      <div className="rounded-md border border-border px-3 py-2 text-xs text-ink">
                        {phone}
                      </div>
                    )}
                    {email && (
                      <div className="rounded-md border border-border px-3 py-2 text-xs text-ink">
                        {email}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {saveMessage === "success" && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Config saved.
        </p>
      )}
      {saveMessage === "error" && (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          Failed to save. Please try again.
        </p>
      )}

      <Button
        onClick={save}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save maintenance config"}
      </Button>
    </div>
  );
}
