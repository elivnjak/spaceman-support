"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";

type User = { id: string; email: string; role: string; createdAt: string };

export default function AdminUsersPageClient({
  currentUserId,
}: {
  currentUserId: string | null;
}) {
  const [list, setList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ email: "", password: "", role: "editor" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadList = () => {
    setError(null);
    setLoading(true);
    fetch("/api/admin/users")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          throw new Error(
            data && typeof data === "object" && "error" in data
              ? String(data.error)
              : "Failed to load users"
          );
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setList)
      .catch((err: unknown) => {
        setList([]);
        setError(err instanceof Error ? err.message : "Failed to load users");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, []);

  const startEdit = (user: User) => {
    setEditing(user);
    setEditForm({ email: user.email, password: "", role: user.role });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSavingEdit(true);
    try {
      const body: { email?: string; password?: string; role?: string } = {
        email: editForm.email.trim(),
        role: editForm.role,
      };
      if (editForm.password) body.password = editForm.password;
      const res = await fetch(`/api/admin/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setList((prev) =>
          prev.map((u) => (u.id === editing.id ? data : u))
        );
        setEditing(null);
      } else {
        setError(data.error ?? "Failed to update user");
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (res.ok) {
        setList((prev) => prev.filter((u) => u.id !== id));
        setDeleteId(null);
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to delete user");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <PageHeader
        title="Users"
        actions={
          <Link
            href="/admin/users/new"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover min-h-[44px]"
          >
            Add user
          </Link>
        }
      />
      {error && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {list.map((u) => (
          <li
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface p-3 shadow-card"
          >
            <div>
              <span className="font-medium text-ink">{u.email}</span>
              <Badge className="ml-2" variant={u.role === "admin" ? "info" : "default"}>
                {u.role}
              </Badge>
              {currentUserId === u.id && (
                <span className="ml-2 text-xs text-muted">(you)</span>
              )}
              <p className="mt-1 text-sm text-muted">
                Created {new Date(u.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => startEdit(u)}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteId(u.id)}
                disabled={currentUserId === u.id}
                title={currentUserId === u.id ? "You cannot delete your own account" : "Delete user"}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={!!editing} onClose={() => setEditing(null)}>
        <h2 className="mb-4 text-lg font-semibold text-ink">Edit user</h2>
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
          <Input
            type="email"
            placeholder="Email"
            value={editForm.email}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, email: e.target.value }))
            }
            required
          />
          <Input
            type="password"
            placeholder="New password (leave blank to keep)"
            value={editForm.password}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, password: e.target.value }))
            }
          />
          <select
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink min-h-[44px]"
            value={editForm.role}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, role: e.target.value }))
            }
          >
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={savingEdit}
            >
              {savingEdit ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteId} onClose={() => !deleting && setDeleteId(null)} size="sm">
        <p className="mb-4 text-ink">
          Are you sure you want to delete this user? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={() => setDeleteId(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            type="button"
            onClick={() => deleteId && confirmDelete(deleteId)}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
