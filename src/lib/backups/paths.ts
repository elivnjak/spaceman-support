import { mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { getErrorLogsRoot } from "@/lib/error-logs";
import { getStorageRoot } from "@/lib/storage";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_LIBRARY_DIRNAME = "__backups";
export const BACKUP_ARCHIVES_DIRNAME = "archives";
export const BACKUP_METADATA_DIRNAME = "metadata";
export const BACKUP_OPERATIONS_DIRNAME = "operations";
export const BACKUP_TMP_DIRNAME = "tmp";

export function getBackupRoot(): string {
  return path.join(getStorageRoot(), BACKUP_LIBRARY_DIRNAME);
}

export function getBackupArchivesRoot(): string {
  return path.join(getBackupRoot(), BACKUP_ARCHIVES_DIRNAME);
}

export function getBackupMetadataRoot(): string {
  return path.join(getBackupRoot(), BACKUP_METADATA_DIRNAME);
}

export function getBackupOperationsRoot(): string {
  return path.join(getBackupRoot(), BACKUP_OPERATIONS_DIRNAME);
}

export function getBackupTmpRoot(): string {
  return path.join(tmpdir(), "spaceman-support", BACKUP_LIBRARY_DIRNAME, BACKUP_TMP_DIRNAME);
}

export function getActiveOperationPath(): string {
  return path.join(getBackupOperationsRoot(), "active.json");
}

export function getLastOperationPath(): string {
  return path.join(getBackupOperationsRoot(), "last.json");
}

export function getRestoreLockPath(): string {
  return path.join(getBackupOperationsRoot(), "restore-lock.json");
}

export function getBackupArchivePath(backupId: string, archiveFileName: string): string {
  return path.join(getBackupArchivesRoot(), `${backupId}-${archiveFileName}`);
}

export function getBackupMetadataPath(backupId: string): string {
  return path.join(getBackupMetadataRoot(), `${backupId}.json`);
}

export async function ensureBackupDirectories(): Promise<void> {
  await Promise.all([
    mkdir(getBackupRoot(), { recursive: true }),
    mkdir(getBackupArchivesRoot(), { recursive: true }),
    mkdir(getBackupMetadataRoot(), { recursive: true }),
    mkdir(getBackupOperationsRoot(), { recursive: true }),
    mkdir(getBackupTmpRoot(), { recursive: true }),
  ]);
}

export function normalizeToPosix(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function getErrorLogsStorageRelativePath(): string | null {
  const storageRoot = path.resolve(getStorageRoot());
  const errorLogsRoot = path.resolve(getErrorLogsRoot());
  const relative = path.relative(storageRoot, errorLogsRoot);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return normalizeToPosix(relative);
}

export function getStorageBackupExclusions(): string[] {
  const exclusions = [BACKUP_LIBRARY_DIRNAME];
  const errorLogsRelative = getErrorLogsStorageRelativePath();
  if (errorLogsRelative) {
    exclusions.push(errorLogsRelative);
  }
  return exclusions.map(normalizeToPosix);
}

export function pathMatchesPrefix(relativePath: string, prefix: string): boolean {
  const normalizedPath = normalizeToPosix(relativePath);
  const normalizedPrefix = normalizeToPosix(prefix).replace(/\/+$/, "");
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

export function shouldIncludeStorageRelativePath(relativePath: string): boolean {
  const normalized = normalizeToPosix(relativePath);
  if (!normalized) return true;
  return !getStorageBackupExclusions().some((prefix) => pathMatchesPrefix(normalized, prefix));
}

export function sanitizeFileComponent(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  const sanitized = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return sanitized || fallback;
}
