"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  const [editForm, setEditForm] = useState({ email: "", password: "", role: "admin" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadList = () => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then(setList)
      .catch(() => setList([]))
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

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <Link
          href="/admin/users/new"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Add user
        </Link>
      </div>
      {error && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {list.map((u) => (
          <li
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div>
              <span className="font-medium">{u.email}</span>
              <span className="ml-2 text-sm text-gray-500">({u.role})</span>
              {currentUserId === u.id && (
                <span className="ml-2 text-xs text-gray-500">(you)</span>
              )}
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Created {new Date(u.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => startEdit(u)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setDeleteId(u.id)}
                disabled={currentUserId === u.id}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                title={currentUserId === u.id ? "You cannot delete your own account" : "Delete user"}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            aria-hidden
            onClick={() => setEditing(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold">Edit user</h2>
            <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
              <input
                type="email"
                placeholder="Email"
                className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, email: e.target.value }))
                }
                required
              />
              <input
                type="password"
                placeholder="New password (leave blank to keep)"
                className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, password: e.target.value }))
                }
              />
              <select
                className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                value={editForm.role}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, role: e.target.value }))
                }
              >
                <option value="admin">admin</option>
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {deleteId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            aria-hidden
            onClick={() => !deleting && setDeleteId(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-4">
              Are you sure you want to delete this user? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmDelete(deleteId)}
                disabled={deleting}
                className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
