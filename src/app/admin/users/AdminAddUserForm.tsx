"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function AdminAddUserForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", role: "editor" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/admin/users");
      } else {
        setError(data.error ?? "Failed to create user");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Add user" />
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
