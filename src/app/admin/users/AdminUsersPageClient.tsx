"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatDateAu } from "@/lib/date-format";

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
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "editor">("all");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

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

  useEffect(() => {
    setPage(1);
  }, [query, roleFilter, pageSize]);

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

  const sortedUsers = useMemo(
    () => [...list].sort((a, b) => a.email.localeCompare(b.email)),
    [list]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    return sortedUsers.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!normalizedQuery) return true;
      return user.email.toLowerCase().includes(normalizedQuery);
    });
  }, [sortedUsers, roleFilter, normalizedQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedUsers = filteredUsers.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

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

      <section className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[260px] flex-1">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by email..."
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as "all" | "admin" | "editor")}
          className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          aria-label="Filter by role"
        >
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
        </select>
        <select
          value={String(pageSize)}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink"
          aria-label="Users per page"
        >
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </select>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setQuery("");
            setRoleFilter("all");
          }}
          disabled={!query && roleFilter === "all"}
        >
          Clear filters
        </Button>
      </section>

      <div className="mb-4 text-right text-sm text-muted">
        {filteredUsers.length} shown / {list.length} total
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-page">
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-sm text-muted" colSpan={4}>
                  No users found.
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-sm text-muted" colSpan={4}>
                  No users match the current filters.
                </td>
              </tr>
            ) : (
              paginatedUsers.map((u) => (
                <tr key={u.id} className="text-sm">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{u.email}</div>
                    {currentUserId === u.id && <div className="text-xs text-muted">(you)</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.role === "admin" ? "info" : "default"}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {formatDateAu(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(u)}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteId(u.id)}
                        disabled={currentUserId === u.id}
                        title={
                          currentUserId === u.id
                            ? "You cannot delete your own account"
                            : "Delete user"
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filteredUsers.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={safePage <= 1}
                aria-label="First page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={safePage <= 1}
                aria-label="Previous page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ‹
              </button>

              {(() => {
                const pages: (number | "...")[] = [];
                const total = totalPages;
                const current = safePage;
                if (total <= 7) {
                  for (let i = 1; i <= total; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (current > 3) pages.push("...");
                  const start = Math.max(2, current - 1);
                  const end = Math.min(total - 1, current + 1);
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (current < total - 2) pages.push("...");
                  pages.push(total);
                }
                return pages.map((p, idx) =>
                  p === "..." ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="flex h-8 w-8 items-center justify-center text-sm text-muted"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p as number)}
                      aria-label={`Page ${p}`}
                      aria-current={p === current ? "page" : undefined}
                      className={`flex h-8 min-w-[2rem] items-center justify-center rounded-md border px-2 text-sm transition-colors ${
                        p === current
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface text-ink hover:bg-page"
                      }`}
                    >
                      {p}
                    </button>
                  )
                );
              })()}

              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={safePage >= totalPages}
                aria-label="Next page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => setPage(totalPages)}
                disabled={safePage >= totalPages}
                aria-label="Last page"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
              >
                »
              </button>
            </div>
          )}
          <p className="text-sm text-muted">
            Showing {(safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, filteredUsers.length)} of {filteredUsers.length} user
            {filteredUsers.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

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
