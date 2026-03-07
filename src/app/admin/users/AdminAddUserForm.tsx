"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const PASSWORD_MIN_LENGTH = 12;

export default function AdminAddUserForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    role: "editor",
    sendEmail: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          sendEmail: form.sendEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const params = new URLSearchParams();
        params.set(
          "notice",
          form.sendEmail && !data.warning ? "user-created-and-emailed" : "user-created"
        );
        if (typeof data.warning === "string" && data.warning.trim()) {
          params.set("warning", data.warning.trim());
        }
        router.push(`/admin/users?${params.toString()}`);
      } else {
        setError(data.error ?? "Failed to create user");
      }
    } catch {
      setError("Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Add user"
        description="Create an admin or editor account and optionally email secure setup instructions."
      />
      {error && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
            <p className="mt-1 text-sm text-muted">
              Minimum {PASSWORD_MIN_LENGTH} characters. The user will be asked to change it
              after signing in.
            </p>
          </div>
          <div>
            <label htmlFor="role" className="mb-1 block text-sm font-medium text-ink">
              Role
            </label>
            <select
              id="role"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            >
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-page px-3 py-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-border"
              checked={form.sendEmail}
              onChange={(e) => setForm((f) => ({ ...f, sendEmail: e.target.checked }))}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-ink">
                Email login and setup instructions
              </span>
              <span className="block text-sm text-muted">
                Sends a secure setup link so the user can choose a new password. If unchecked,
                you&apos;ll need to share the temporary password manually.
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <Link
              href="/admin/users"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-aqua/30 min-h-[44px]"
            >
              Cancel
            </Link>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add user"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
