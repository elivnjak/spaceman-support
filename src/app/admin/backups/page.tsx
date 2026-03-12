"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDateTimeAu } from "@/lib/date-format";

type BackupStoredSource = "manual" | "imported" | "safety";
type BackupOperationStatus = "running" | "completed" | "failed";
type BackupOperationType = "create" | "import" | "restore";

type BackupSummary = {
  id: string;
  name: string;
  archiveFileName: string;
  createdAt: string;
  storedAt: string;
  storedSource: BackupStoredSource;
  sizeBytes: number;
  schemaSignature: string;
  schemaMatchesCurrent: boolean;
  sourceAppName: string;
  rowCount: number;
  storageFiles: number;
};

type BackupOperationState = {
  id: string;
  type: BackupOperationType;
  status: BackupOperationStatus;
  backupId?: string;
  backupName?: string;
  message: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
};

type RestoreLockState = {
  active: true;
  operationId: string;
  backupId: string;
  backupName: string;
  startedAt: string;
  message: string;
};

type BackupsResponse = {
  backups: BackupSummary[];
  operation: BackupOperationState | null;
  restoreLock: RestoreLockState | null;
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function sourceLabel(value: BackupStoredSource): string {
  if (value === "imported") return "Uploaded";
  if (value === "safety") return "Safety";
  return "Manual";
}

export default function AdminBackupsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [data, setData] = useState<BackupsResponse>({
    backups: [],
    operation: null,
    restoreLock: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actingBackupId, setActingBackupId] = useState<string | null>(null);
  const [dismissedOperationKey, setDismissedOperationKey] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  async function refreshBackups() {
    const response = await fetch("/api/admin/backups", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load backups.");
    }
    const payload = (await response.json()) as BackupsResponse;
    setData(payload);
  }

  useEffect(() => {
    refreshBackups()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load backups.");
      })
      .finally(() => setLoading(false));
  }, [refreshTick]);

  useEffect(() => {
    if (data.operation?.status !== "running" && !data.restoreLock) return;
    const interval = window.setInterval(() => {
      setRefreshTick((value) => value + 1);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [data.operation?.status, data.restoreLock]);

  useEffect(() => {
    if (!data.operation) {
      setDismissedOperationKey(null);
      return;
    }
    const operationKey = `${data.operation.id}:${data.operation.status}:${data.operation.updatedAt}`;
    if (data.operation.status === "running") {
      setDismissedOperationKey(null);
    } else if (dismissedOperationKey && dismissedOperationKey !== operationKey) {
      setDismissedOperationKey(null);
    }
  }, [data.operation, dismissedOperationKey]);

  useEffect(() => {
    if (!error) {
      setDismissedError(null);
      return;
    }
    if (dismissedError && dismissedError !== error) {
      setDismissedError(null);
    }
  }, [dismissedError, error]);

  const busy = data.operation?.status === "running" || creating || uploading || actingBackupId !== null;
  const operationKey = data.operation
    ? `${data.operation.id}:${data.operation.status}:${data.operation.updatedAt}`
    : null;
  const visibleOperation =
    data.operation && (data.operation.status === "running" || dismissedOperationKey !== operationKey)
      ? data.operation
      : null;
  const visibleError = error && dismissedError !== error ? error : null;
  const sortedBackups = useMemo(
    () => [...data.backups].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [data.backups]
  );

  async function handleCreateBackup() {
    setCreating(true);
    setError(null);
    setDismissedError(null);
    try {
      const response = await fetch("/api/admin/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim() || undefined }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to start backup creation.");
      }
      setCreateName("");
      setRefreshTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start backup creation.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUploadBackup() {
    if (!uploadFile) return;
    setUploading(true);
    setError(null);
    setDismissedError(null);
    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      const response = await fetch("/api/admin/backups/import", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to upload backup.");
      }
      setUploadFile(null);
      setRefreshTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload backup.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRestore(backup: BackupSummary) {
    const confirmation = window.prompt(
      `Type RESTORE to confirm restoring "${backup.name}". This replaces the current database and storage, creates a safety backup first, and may log you out.`
    );
    if (confirmation !== "RESTORE") return;

    setActingBackupId(backup.id);
    setError(null);
    setDismissedError(null);
    try {
      const response = await fetch(`/api/admin/backups/${encodeURIComponent(backup.id)}/restore`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to start restore.");
      }
      setRefreshTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start restore.");
    } finally {
      setActingBackupId(null);
    }
  }

  async function handleDelete(backup: BackupSummary) {
    if (!window.confirm(`Delete backup "${backup.name}"? This cannot be undone.`)) return;

    setActingBackupId(backup.id);
    setError(null);
    setDismissedError(null);
    try {
      const response = await fetch(`/api/admin/backups/${encodeURIComponent(backup.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to delete backup.");
      }
      setRefreshTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete backup.");
    } finally {
      setActingBackupId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backups"
        description="Create, store, download, upload, restore, and delete full instance backups. Backups include the full database plus storage files, including audit assets, while excluding error logs."
      />

      {data.restoreLock && (
        <div className="rounded-card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Restore in progress for <strong>{data.restoreLock.backupName}</strong>. Chat and admin writes are temporarily blocked until the restore completes.
        </div>
      )}

      {visibleOperation && (
        <div
          className={`rounded-card border p-4 text-sm ${
            visibleOperation.status === "failed"
              ? "border-red-300 bg-red-50 text-red-900"
              : visibleOperation.status === "completed"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border-blue-300 bg-blue-50 text-blue-900"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">
                {visibleOperation.type === "restore"
              ? "Restore"
              : visibleOperation.type === "import"
                ? "Upload"
                : "Backup"}{" "}
                {visibleOperation.status}
              </p>
              <p>{visibleOperation.message}</p>
              <p className="mt-1 text-xs opacity-80">
                Updated {formatDateTimeAu(visibleOperation.updatedAt)}
              </p>
            </div>
            {visibleOperation.status !== "running" && operationKey ? (
              <button
                type="button"
                onClick={() => setDismissedOperationKey(operationKey)}
                className="rounded px-2 py-1 text-xs font-medium opacity-80 transition-colors hover:bg-black/5 hover:opacity-100"
                aria-label="Dismiss backup status message"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      )}

      {visibleError && (
        <div className="rounded-card border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <div className="flex items-start justify-between gap-4">
            <p>{visibleError}</p>
            <button
              type="button"
              onClick={() => setDismissedError(visibleError)}
              className="rounded px-2 py-1 text-xs font-medium opacity-80 transition-colors hover:bg-black/5 hover:opacity-100"
              aria-label="Dismiss backup error message"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-ink">Create backup</h2>
          <p className="mt-1 text-sm text-muted">
            Create a stored backup on this instance. Leave the name blank to use an automatic timestamped name.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Optional backup name"
              disabled={busy}
            />
            <Button onClick={handleCreateBackup} disabled={busy}>
              {creating ? "Starting..." : "Create backup"}
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-ink">Upload backup</h2>
          <p className="mt-1 text-sm text-muted">
            Upload a previously downloaded backup archive so it can be restored from this instance.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              disabled={busy}
              className="text-sm text-ink"
            />
            <Button onClick={handleUploadBackup} disabled={busy || !uploadFile}>
              {uploading ? "Uploading..." : "Upload backup"}
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Stored backups</h2>
            <p className="text-sm text-muted">
              Restore creates a safety backup first, then replaces the current database and storage. Your current session may be invalid afterward.
            </p>
          </div>
          <p className="text-sm text-muted">
            {sortedBackups.length} backup{sortedBackups.length === 1 ? "" : "s"}
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Loading backups...</p>
        ) : sortedBackups.length === 0 ? (
          <p className="text-sm text-muted">No backups stored yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-page">
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Archive</th>
                  <th className="px-4 py-3">Contents</th>
                  <th className="px-4 py-3">Compatibility</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedBackups.map((backup) => {
                  const restoreDisabled =
                    busy ||
                    !backup.schemaMatchesCurrent ||
                    data.operation?.status === "running";

                  return (
                    <tr key={backup.id} className="text-sm">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{backup.name}</p>
                        <p className="text-xs text-muted">{backup.sourceAppName}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">{sourceLabel(backup.storedSource)}</td>
                      <td className="px-4 py-3 text-muted">{formatDateTimeAu(backup.createdAt)}</td>
                      <td className="px-4 py-3 text-muted">
                        <p>{formatSize(backup.sizeBytes)}</p>
                        <p className="text-xs">{backup.archiveFileName}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <p>{backup.rowCount} DB rows</p>
                        <p className="text-xs">{backup.storageFiles} storage files</p>
                      </td>
                      <td className="px-4 py-3">
                        {backup.schemaMatchesCurrent ? (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            Ready to restore
                          </span>
                        ) : (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Schema mismatch
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <a
                            href={`/api/admin/backups/${encodeURIComponent(backup.id)}/download`}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-aqua/30"
                          >
                            Download
                          </a>
                          <Button
                            variant="secondary"
                            onClick={() => handleRestore(backup)}
                            disabled={restoreDisabled}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => handleDelete(backup)}
                            disabled={busy}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
