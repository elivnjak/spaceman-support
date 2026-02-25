"use client";

import { useEffect, useState } from "react";

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
      <h1 className="text-2xl font-bold">Maintenance mode</h1>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-lg font-semibold">Status</h2>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          When enabled, the chat is offline for public users. Logged-in admins can
          still use the chat.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              enabled ? "bg-green-600" : "bg-gray-200 dark:bg-gray-600"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span
            className={`font-medium ${enabled ? "text-green-700 dark:text-green-400" : "text-gray-600 dark:text-gray-400"}`}
          >
            {enabled ? "Maintenance on (chat offline for public)" : "Maintenance off"}
          </span>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-2 text-lg font-semibold">Icon</h2>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Optional image shown on the maintenance page (e.g. logo or wrench).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            type="button"
            onClick={uploadIcon}
            disabled={uploading || !iconFile}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload icon"}
          </button>
          {iconUrl && (
            <button
              type="button"
              onClick={deleteIcon}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
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
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-lg font-semibold">Content</h2>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Text and contact details shown on the maintenance page.
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              placeholder="Chat Unavailable"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              placeholder="Our support chat is currently undergoing maintenance."
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              placeholder="+1 234 567 8900"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
              placeholder="support@example.com"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-lg font-semibold">Preview</h2>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          How the maintenance page will look to public users.
        </p>
        <div className="flex justify-center rounded border border-dashed border-gray-300 bg-gray-100 p-8 dark:border-gray-600 dark:bg-gray-950">
          <div className="w-full max-w-xs rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-col items-center gap-4 text-center">
              {iconUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={iconUrl}
                  alt=""
                  className="h-12 w-auto object-contain"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                  <svg
                    className="h-5 w-5 text-gray-400 dark:text-gray-500"
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
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {title || "Chat Unavailable"}
                </h3>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {description || "Our support chat is currently undergoing maintenance."}
                </p>
              </div>
              {(phone || email) && (
                <>
                  <div className="w-full border-t border-gray-100 dark:border-gray-700" />
                  <div className="w-full space-y-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Need help? Contact us
                    </p>
                    {phone && (
                      <div className="rounded-md border border-gray-100 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-300">
                        {phone}
                      </div>
                    )}
                    {email && (
                      <div className="rounded-md border border-gray-100 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-300">
                        {email}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {saveMessage === "success" && (
        <p className="rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
          Config saved.
        </p>
      )}
      {saveMessage === "error" && (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          Failed to save. Please try again.
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save maintenance config"}
      </button>
    </div>
  );
}
