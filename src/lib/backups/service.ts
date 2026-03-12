import { cp, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import * as tar from "tar";
import { getStorageRoot } from "@/lib/storage";
import {
  computeSchemaSignature,
  exportDatabaseToDirectory,
  getManagedTableNames,
  restoreDatabaseFromDirectory,
} from "./db-plan";
import {
  BACKUP_FORMAT_VERSION,
  ensureBackupDirectories,
  getActiveOperationPath,
  getBackupArchivePath,
  getBackupArchivesRoot,
  getBackupMetadataPath,
  getBackupMetadataRoot,
  getBackupTmpRoot,
  getLastOperationPath,
  getStorageBackupExclusions,
  normalizeToPosix,
  pathMatchesPrefix,
  sanitizeFileComponent,
  shouldIncludeStorageRelativePath,
} from "./paths";
import {
  clearRestoreLock,
  readRestoreLock,
  writeRestoreLock,
  type RestoreLockState,
} from "./restore-lock";

export type BackupStoredSource = "manual" | "imported" | "safety";
export type BackupOperationType = "create" | "import" | "restore";
export type BackupOperationStatus = "running" | "completed" | "failed";

export type BackupManifest = {
  formatVersion: number;
  backupId: string;
  backupName: string;
  createdAt: string;
  sourceKind: BackupStoredSource;
  schemaSignature: string;
  app: {
    name: string;
    baseUrl: string | null;
    hostname: string;
    nodeEnv: string;
  };
  tables: string[];
  rowCounts: Record<string, number>;
  storage: {
    files: number;
    bytes: number;
    excluded: string[];
  };
};

export type BackupSummary = {
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

export type BackupRecord = BackupSummary & {
  manifest: BackupManifest;
};

export type BackupOperationState = {
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
  pid: number;
};

type OperationResult = {
  backupId?: string;
  backupName?: string;
  message: string;
};

function normalizeImportArchiveError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("unexpected end of file") ||
      message.includes("unexpected eof") ||
      message.includes("zlib:")
    ) {
      return new Error(
        "The uploaded backup archive was incomplete or corrupted before it reached the server. If you are running locally, restart the app so the latest upload size limit is active, then upload the backup again."
      );
    }
    return error;
  }

  return new Error("Backup import failed.");
}

function getBaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_BASE_URL?.trim() || null;
}

function timestampLabel(date = new Date()): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildDefaultBackupName(source: BackupStoredSource, label?: string): string {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  if (source === "safety") {
    return `pre-restore-${timestampLabel()}`;
  }
  return `backup-${timestampLabel()}`;
}

function buildOperationMessage(type: BackupOperationType, backupName: string): string {
  if (type === "import") return `Importing ${backupName}`;
  if (type === "restore") return `Restoring ${backupName}`;
  return `Creating ${backupName}`;
}

function hashSuffix(value: string): string {
  return Buffer.from(value).toString("hex").slice(0, 8);
}

function isPidActive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureBackupDirectories();
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readActiveOperation(): Promise<BackupOperationState | null> {
  const active = await readJsonFile<BackupOperationState>(getActiveOperationPath());
  if (!active) return null;
  if (active.status !== "running") return active;
  if (isPidActive(active.pid)) return active;

  const failed: BackupOperationState = {
    ...active,
    status: "failed",
    message: "The previous backup operation ended unexpectedly.",
    error: "The previous backup operation ended unexpectedly.",
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(getLastOperationPath(), failed);
  await unlink(getActiveOperationPath()).catch(() => {});
  return null;
}

export async function getCurrentBackupOperation(): Promise<BackupOperationState | null> {
  return (await readActiveOperation()) ?? (await readJsonFile<BackupOperationState>(getLastOperationPath()));
}

async function reserveOperation(
  type: BackupOperationType,
  backupId?: string,
  backupName?: string
): Promise<BackupOperationState> {
  await ensureBackupDirectories();
  const existing = await readActiveOperation();
  if (existing?.status === "running") {
    throw new Error(`${existing.message}. Please wait for it to finish.`);
  }

  const now = new Date().toISOString();
  const operation: BackupOperationState = {
    id: crypto.randomUUID(),
    type,
    status: "running",
    backupId,
    backupName,
    message: buildOperationMessage(type, backupName ?? "backup"),
    startedAt: now,
    updatedAt: now,
    pid: process.pid,
  };

  try {
    await writeFile(getActiveOperationPath(), `${JSON.stringify(operation, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    const active = await readActiveOperation();
    if (active?.status === "running") {
      throw new Error(`${active.message}. Please wait for it to finish.`);
    }
    await unlink(getActiveOperationPath()).catch(() => {});
    await writeJsonFile(getActiveOperationPath(), operation);
  }

  return operation;
}

async function updateOperation(
  operation: BackupOperationState,
  patch: Partial<BackupOperationState>
): Promise<void> {
  const next: BackupOperationState = {
    ...operation,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  Object.assign(operation, next);
  await writeJsonFile(getActiveOperationPath(), next);
}

async function finishOperation(
  operation: BackupOperationState,
  status: BackupOperationStatus,
  result: OperationResult,
  error?: string
): Promise<void> {
  const finished: BackupOperationState = {
    ...operation,
    status,
    backupId: result.backupId ?? operation.backupId,
    backupName: result.backupName ?? operation.backupName,
    message: result.message,
    error,
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(getLastOperationPath(), finished);
  await unlink(getActiveOperationPath()).catch(() => {});
}

async function runOperation(
  operation: BackupOperationState,
  work: (operation: BackupOperationState) => Promise<OperationResult>
): Promise<void> {
  void Promise.resolve()
    .then(async () => {
      try {
        const result = await work(operation);
        await finishOperation(operation, "completed", result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Backup operation failed.";
        await finishOperation(
          operation,
          "failed",
          {
            backupId: operation.backupId,
            backupName: operation.backupName,
            message,
          },
          message
        );
      }
    });
}

async function withTempDir<T>(callback: (tempDir: string) => Promise<T>): Promise<T> {
  await ensureBackupDirectories();
  const tempDir = await mkdtemp(path.join(getBackupTmpRoot(), "job-"));
  try {
    return await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function collectStorageStats(rootDir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectStorageStats(fullPath);
      files += nested.files;
      bytes += nested.bytes;
      continue;
    }
    if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      files += 1;
      bytes += fileStat.size;
    }
  }

  return { files, bytes };
}

async function copyStorageIntoDirectory(targetDir: string): Promise<{ files: number; bytes: number }> {
  const storageRoot = getStorageRoot();
  const destination = path.join(targetDir, "storage");
  await cp(storageRoot, destination, {
    recursive: true,
    force: true,
    filter(source) {
      const relative = normalizeToPosix(path.relative(storageRoot, source));
      return shouldIncludeStorageRelativePath(relative);
    },
  });

  return collectStorageStats(destination);
}

function buildManifest(input: {
  backupId: string;
  backupName: string;
  sourceKind: BackupStoredSource;
  schemaSignature: string;
  rowCounts: Record<string, number>;
  storageStats: { files: number; bytes: number };
}): BackupManifest {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: input.backupId,
    backupName: input.backupName,
    createdAt: new Date().toISOString(),
    sourceKind: input.sourceKind,
    schemaSignature: input.schemaSignature,
    app: {
      name: process.env.RAILWAY_PROJECT_NAME?.trim() || "spaceman-support",
      baseUrl: getBaseUrl(),
      hostname: process.env.HOSTNAME?.trim() || "unknown",
      nodeEnv: process.env.NODE_ENV ?? "development",
    },
    tables: getManagedTableNames(),
    rowCounts: input.rowCounts,
    storage: {
      files: input.storageStats.files,
      bytes: input.storageStats.bytes,
      excluded: getStorageBackupExclusions(),
    },
  };
}

async function createArchiveFromDirectory(sourceDir: string, archivePath: string): Promise<void> {
  await tar.c(
    {
      cwd: sourceDir,
      gzip: true,
      file: archivePath,
      portable: true,
      noMtime: true,
    },
    ["manifest.json", "db", "storage"]
  );
}

async function validateArchiveEntries(archivePath: string): Promise<void> {
  const entryPaths: string[] = [];
  await tar.t({
    file: archivePath,
    onentry(entry: { path: string }) {
      entryPaths.push(normalizeToPosix(entry.path));
    },
  });

  for (const entryPath of entryPaths) {
    if (!entryPath || entryPath.startsWith("/") || entryPath.includes("..")) {
      throw new Error("Backup archive contains an invalid file path.");
    }
  }
}

function validateManifestStructure(manifest: BackupManifest): void {
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("Backup format version is not supported.");
  }

  const expectedTables = getManagedTableNames();
  if (
    manifest.tables.length !== expectedTables.length ||
    !expectedTables.every((name, index) => manifest.tables[index] === name)
  ) {
    throw new Error("Backup table order does not match this instance.");
  }
}

function validateManifestAgainstCurrentSchema(
  manifest: BackupManifest,
  currentSchemaSignature: string
): void {
  validateManifestStructure(manifest);
  if (manifest.schemaSignature !== currentSchemaSignature) {
    throw new Error("Backup schema signature does not match this instance.");
  }
}

async function createArchiveMetadata(
  manifest: BackupManifest,
  archivePath: string,
  storedSource: BackupStoredSource
): Promise<BackupRecord> {
  const archiveStat = await stat(archivePath);
  const currentSchemaSignature = await computeSchemaSignature();
  const summary: BackupRecord = {
    id: manifest.backupId,
    name: manifest.backupName,
    archiveFileName: path.basename(archivePath),
    createdAt: manifest.createdAt,
    storedAt: new Date().toISOString(),
    storedSource,
    sizeBytes: archiveStat.size,
    schemaSignature: manifest.schemaSignature,
    schemaMatchesCurrent: manifest.schemaSignature === currentSchemaSignature,
    sourceAppName: manifest.app.name,
    rowCount: Object.values(manifest.rowCounts).reduce((sum, count) => sum + count, 0),
    storageFiles: manifest.storage.files,
    manifest,
  };
  await writeJsonFile(getBackupMetadataPath(summary.id), summary);
  return summary;
}

async function createBackupSnapshot(source: BackupStoredSource, label?: string): Promise<BackupRecord> {
  const backupName = buildDefaultBackupName(source, label);
  const backupId = `${timestampLabel()}-${crypto.randomUUID().slice(0, 8)}`;
  const archiveFileName = `${sanitizeFileComponent(backupName, "backup")}-${hashSuffix(backupId)}.tar.gz`;
  const archivePath = getBackupArchivePath(backupId, archiveFileName);
  const schemaSignature = await computeSchemaSignature();

  return withTempDir(async (tempDir) => {
    const dbDir = path.join(tempDir, "db");
    const { rowCounts } = await exportDatabaseToDirectory(dbDir);
    const storageStats = await copyStorageIntoDirectory(tempDir);
    const manifest = buildManifest({
      backupId,
      backupName,
      sourceKind: source,
      schemaSignature,
      rowCounts,
      storageStats,
    });
    await writeFile(path.join(tempDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await createArchiveFromDirectory(tempDir, archivePath);
    return createArchiveMetadata(manifest, archivePath, source);
  });
}

async function performArchiveImport(fileName: string, buffer: Buffer): Promise<BackupRecord> {
  const backupId = `${timestampLabel()}-${crypto.randomUUID().slice(0, 8)}`;
  const sanitizedBase = fileName.replace(/\.tar\.gz$/i, "").replace(/\.[^.]+$/g, "");
  const archiveFileName = `${sanitizeFileComponent(sanitizedBase, "backup")}-${hashSuffix(backupId)}.tar.gz`;
  const archivePath = getBackupArchivePath(backupId, archiveFileName);
  await writeFile(archivePath, buffer);

  try {
    return await withTempDir(async (tempDir) => {
      await validateArchiveEntries(archivePath);
      await tar.x({ cwd: tempDir, file: archivePath, gzip: true, strict: true });
      const manifest = JSON.parse(await readFile(path.join(tempDir, "manifest.json"), "utf8")) as BackupManifest;
      validateManifestStructure(manifest);
      const patchedManifest: BackupManifest = {
        ...manifest,
        backupId,
      };
      return createArchiveMetadata(patchedManifest, archivePath, "imported");
    });
  } catch (error) {
    await unlink(archivePath).catch(() => {});
    await unlink(getBackupMetadataPath(backupId)).catch(() => {});
    throw normalizeImportArchiveError(error);
  }
}

async function listBackupRecords(): Promise<BackupSummary[]> {
  await ensureBackupDirectories();
  const entries = await readdir(getBackupMetadataRoot(), { withFileTypes: true }).catch(() => []);
  const currentSchemaSignature = await computeSchemaSignature();
  const records: BackupSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = await readJsonFile<BackupRecord>(path.join(getBackupMetadataRoot(), entry.name));
    if (!record) continue;
    const archiveStat = await stat(path.join(getBackupArchivesRoot(), record.archiveFileName)).catch(() => null);
    records.push({
      ...record,
      sizeBytes: archiveStat?.size ?? record.sizeBytes,
      schemaMatchesCurrent: record.schemaSignature === currentSchemaSignature,
    });
  }

  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function loadBackupRecord(backupId: string): Promise<BackupRecord> {
  const record = await readJsonFile<BackupRecord>(getBackupMetadataPath(backupId));
  if (!record) {
    throw new Error("Backup not found.");
  }
  record.schemaMatchesCurrent = record.schemaSignature === (await computeSchemaSignature());
  return record;
}

async function restoreStorageFromDirectory(sourceStorageDir: string): Promise<void> {
  const storageRoot = getStorageRoot();
  const existingEntries = await readdir(storageRoot, { withFileTypes: true }).catch(() => []);
  const exclusions = getStorageBackupExclusions();

  for (const entry of existingEntries) {
    const relative = normalizeToPosix(entry.name);
    const shouldPreserveEntry = exclusions.some(
      (prefix) => pathMatchesPrefix(prefix, relative) || pathMatchesPrefix(relative, prefix)
    );
    if (shouldPreserveEntry) {
      continue;
    }
    await rm(path.join(storageRoot, entry.name), { recursive: true, force: true });
  }

  const sourceEntries = await readdir(sourceStorageDir, { withFileTypes: true }).catch(() => []);
  for (const entry of sourceEntries) {
    const relative = normalizeToPosix(entry.name);
    if (!shouldIncludeStorageRelativePath(relative)) {
      continue;
    }
    await cp(path.join(sourceStorageDir, entry.name), path.join(storageRoot, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

export async function listBackups(): Promise<{
  backups: BackupSummary[];
  operation: BackupOperationState | null;
  restoreLock: RestoreLockState | null;
}> {
  const [backups, operation, restoreLock] = await Promise.all([
    listBackupRecords(),
    getCurrentBackupOperation(),
    readRestoreLock(),
  ]);

  return { backups, operation, restoreLock };
}

export async function startBackupCreation(label?: string): Promise<BackupOperationState> {
  const backupName = buildDefaultBackupName("manual", label);
  const operation = await reserveOperation("create", undefined, backupName);
  await runOperation(operation, async () => {
    const created = await createBackupSnapshot("manual", label);
    return {
      backupId: created.id,
      backupName: created.name,
      message: `Created ${created.name}`,
    };
  });
  return operation;
}

export async function startBackupImport(fileName: string, buffer: Buffer): Promise<BackupOperationState> {
  const operation = await reserveOperation("import", undefined, fileName);
  await runOperation(operation, async () => {
    const imported = await performArchiveImport(fileName, buffer);
    return {
      backupId: imported.id,
      backupName: imported.name,
      message: `Imported ${imported.name}`,
    };
  });
  return operation;
}

export async function startBackupRestore(backupId: string): Promise<BackupOperationState> {
  const record = await loadBackupRecord(backupId);
  const operation = await reserveOperation("restore", record.id, record.name);
  await runOperation(operation, async (runningOperation) => {
    const restoreLock: RestoreLockState = {
      active: true,
      operationId: runningOperation.id,
      backupId: record.id,
      backupName: record.name,
      startedAt: new Date().toISOString(),
      message: `Restoring ${record.name}`,
    };

    await writeRestoreLock(restoreLock);
    try {
      await updateOperation(runningOperation, {
        message: `Creating safety backup before restoring ${record.name}`,
      });
      await createBackupSnapshot("safety", `pre-restore-${record.name}`);

      await updateOperation(runningOperation, {
        message: `Validating ${record.name}`,
      });

      await withTempDir(async (tempDir) => {
        const archivePath = path.join(getBackupArchivesRoot(), record.archiveFileName);
        await validateArchiveEntries(archivePath);
        await tar.x({ cwd: tempDir, file: archivePath, gzip: true, strict: true });
        const manifest = JSON.parse(await readFile(path.join(tempDir, "manifest.json"), "utf8")) as BackupManifest;
        validateManifestAgainstCurrentSchema(manifest, await computeSchemaSignature());

        await updateOperation(runningOperation, {
          message: `Restoring database from ${record.name}`,
        });
        await restoreDatabaseFromDirectory(path.join(tempDir, "db"));

        await updateOperation(runningOperation, {
          message: `Restoring storage from ${record.name}`,
        });
        await restoreStorageFromDirectory(path.join(tempDir, "storage"));
      });
    } finally {
      await clearRestoreLock();
    }

    return {
      backupId: record.id,
      backupName: record.name,
      message: `Restored ${record.name}`,
    };
  });
  return operation;
}

export async function getBackupDownloadInfo(backupId: string): Promise<{
  record: BackupRecord;
  archivePath: string;
}> {
  const record = await loadBackupRecord(backupId);
  return {
    record,
    archivePath: path.join(getBackupArchivesRoot(), record.archiveFileName),
  };
}

export async function deleteBackup(backupId: string): Promise<void> {
  const active = await readActiveOperation();
  if (active?.status === "running" && active.backupId === backupId) {
    throw new Error("You cannot delete a backup while it is in use by an active operation.");
  }

  const record = await loadBackupRecord(backupId);
  await unlink(getBackupMetadataPath(backupId)).catch(() => {});
  await unlink(path.join(getBackupArchivesRoot(), record.archiveFileName)).catch(() => {});
}
