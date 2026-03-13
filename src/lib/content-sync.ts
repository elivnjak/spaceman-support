import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  actions,
  clearanceConfig,
  clearanceGuideImages,
  diagnosticSessions,
  diagnosisModeConfig,
  docChunks,
  documents,
  evidenceGuideImages,
  intentManifest,
  labels,
  machineSpecs,
  maintenanceConfig,
  nameplateConfig,
  nameplateGuideImages,
  playbookProductTypes,
  playbooks,
  productTypes,
  referenceImages,
  supportedModels,
  supportSessions,
  type Action,
  type ClearanceConfig,
  type ClearanceGuideImage,
  type DiagnosisModeConfig,
  type DocChunk,
  type Document,
  type EvidenceGuideImage,
  type IntentManifestRow,
  type Label,
  type MachineSpec,
  type MaintenanceConfig,
  type NameplateConfig,
  type NameplateGuideImage,
  type Playbook,
  type PlaybookProductType,
  type ProductType,
  type ReferenceImage,
  type SupportedModel,
} from "@/lib/db/schema";
import {
  CLEARANCE_GUIDE_IMAGES_DIR,
  DIAGNOSTIC_SESSIONS_DIR,
  EVIDENCE_GUIDE_IMAGES_DIR,
  MAINTENANCE_ICON_DIR,
  NAMEPLATE_GUIDE_IMAGES_DIR,
  REFERENCE_IMAGES_DIR,
  UPLOADED_DOCS_DIR,
  deleteStorageDirectory,
  ensureDir,
  normalizeStorageRelativePath,
  resolveStoragePath,
  sha256,
  writeStorageFile,
} from "@/lib/storage";

export const KNOWLEDGE_BASE_SYNC_VERSION = 1;
export const DEFAULT_KNOWLEDGE_BASE_SYNC_DIR = path.join(
  process.cwd(),
  "repo_sync",
  "knowledge-base"
);

const MANIFEST_FILE_NAME = "manifest.json";
const DATA_FILE_NAME = "data.json";
const FILES_DIR_NAME = "files";

const EXCLUDED_TABLES = [
  "users",
  "sessions",
  "password_reset_tokens",
  "auth_password_reset_attempts",
  "telegram_config",
  "support_sessions",
  "diagnostic_sessions",
  "audit_logs",
  "ticket_notes",
] as const;

const SYNC_TABLE_NAMES = [
  "labels",
  "supported_models",
  "product_types",
  "actions",
  "documents",
  "doc_chunks",
  "playbooks",
  "playbook_product_types",
  "reference_images",
  "nameplate_guide_images",
  "clearance_guide_images",
  "evidence_guide_images",
  "nameplate_config",
  "clearance_config",
  "maintenance_config",
  "diagnosis_mode_config",
  "intent_manifest",
  "machine_specs",
] as const;

type KnowledgeBaseSyncPayload = {
  labels: Label[];
  supportedModels: SupportedModel[];
  productTypes: ProductType[];
  actions: Action[];
  documents: Document[];
  docChunks: DocChunk[];
  playbooks: Playbook[];
  playbookProductTypes: PlaybookProductType[];
  referenceImages: ReferenceImage[];
  nameplateGuideImages: NameplateGuideImage[];
  clearanceGuideImages: ClearanceGuideImage[];
  evidenceGuideImages: EvidenceGuideImage[];
  nameplateConfig: NameplateConfig[];
  clearanceConfig: ClearanceConfig[];
  maintenanceConfig: MaintenanceConfig[];
  diagnosisModeConfig: DiagnosisModeConfig[];
  intentManifest: IntentManifestRow[];
  machineSpecs: MachineSpec[];
};

type SyncFileRecord = {
  relativePath: string;
  sha256: string;
  size: number;
};

type KnowledgeBaseSyncManifest = {
  bundleType: "knowledge-base";
  version: number;
  exportedAt: string;
  scope: string;
  excludedTables: readonly string[];
  missingTables: string[];
  tableCounts: Record<keyof KnowledgeBaseSyncPayload, number>;
  files: SyncFileRecord[];
};

type ExportResult = {
  outputDir: string;
  manifest: KnowledgeBaseSyncManifest;
};

type ImportResult = {
  inputDir: string;
  manifest: KnowledgeBaseSyncManifest;
  skippedTargetTables: string[];
};

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  return writeFile(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`, "utf8");
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date || b instanceof Date) {
    return new Date(String(a)).getTime() - new Date(String(b)).getTime();
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function sortRows<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const diff = compareValues(left[key], right[key]);
      if (diff !== 0) return diff;
    }
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function normalizeStoredFilePath(filePath: string): string {
  return normalizeStorageRelativePath(filePath);
}

function normalizeDocumentRow(row: Document): Document {
  if (row.filePath === "_pasted" || row.filePath === "_url") {
    return row;
  }
  return {
    ...row,
    filePath: normalizeStoredFilePath(row.filePath),
  };
}

function normalizeImageRow<T extends { filePath: string }>(row: T): T {
  return {
    ...row,
    filePath: normalizeStoredFilePath(row.filePath),
  };
}

function normalizeMaintenanceConfigRow(row: MaintenanceConfig): MaintenanceConfig {
  return {
    ...row,
    iconPath: row.iconPath ? normalizeStoredFilePath(row.iconPath) : null,
  };
}

function hydrateDateFields<T extends Record<string, unknown>>(row: T, fields: string[]): T {
  const next = { ...row };
  const mutableNext = next as Record<string, unknown>;
  for (const field of fields) {
    const value = next[field];
    if (typeof value === "string" && value.trim()) {
      mutableNext[field] = new Date(value);
    }
  }
  return next;
}

function restoreStoredFilePath(filePath: string): string {
  if (filePath === "_pasted" || filePath === "_url") {
    return filePath;
  }
  return resolveStoragePath(filePath);
}

function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

async function insertBatched(database: any, table: any, rows: unknown[], chunkSize = 100): Promise<void> {
  for (const batch of chunkRows(rows, chunkSize)) {
    if (batch.length === 0) continue;
    await database.insert(table).values(batch);
  }
}

async function getExistingPublicTableNames(database: any = db): Promise<Set<string>> {
  const result = await database.execute(sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `);

  const rows = Array.isArray(result)
    ? result
    : (result as { rows?: Record<string, unknown>[] }).rows ?? [];

  return new Set(
    rows
      .map((row) => String(row.tablename ?? ""))
      .filter((value) => value.length > 0)
  );
}

async function selectIfTableExists<T>(
  existingTables: Set<string>,
  tableName: string,
  load: () => Promise<T[]>
): Promise<T[]> {
  if (!existingTables.has(tableName)) {
    return [];
  }
  return load();
}

async function deleteIfTableExists(existingTables: Set<string>, database: any, tableName: string, table: any) {
  if (!existingTables.has(tableName)) {
    return;
  }
  await database.delete(table);
}

async function insertIfTableExists(
  existingTables: Set<string>,
  database: any,
  tableName: string,
  table: any,
  rows: unknown[],
  chunkSize = 100
) {
  if (!existingTables.has(tableName)) {
    return;
  }
  await insertBatched(database, table, rows, chunkSize);
}

async function collectStorageFile(
  filesDir: string,
  records: Map<string, SyncFileRecord>,
  filePath: string | null | undefined
): Promise<void> {
  if (!filePath || filePath === "_pasted" || filePath === "_url") {
    return;
  }

  const relativePath = normalizeStoredFilePath(filePath);
  if (records.has(relativePath)) return;

  const sourcePath = path.isAbsolute(filePath) ? filePath : resolveStoragePath(relativePath);
  const buffer = await readFile(sourcePath);
  const destinationPath = path.join(filesDir, relativePath);
  await ensureDir(path.dirname(destinationPath));
  await writeFile(destinationPath, buffer);

  records.set(relativePath, {
    relativePath,
    sha256: sha256(buffer),
    size: buffer.byteLength,
  });
}

function getTableCounts(payload: KnowledgeBaseSyncPayload): Record<keyof KnowledgeBaseSyncPayload, number> {
  return {
    labels: payload.labels.length,
    supportedModels: payload.supportedModels.length,
    productTypes: payload.productTypes.length,
    actions: payload.actions.length,
    documents: payload.documents.length,
    docChunks: payload.docChunks.length,
    playbooks: payload.playbooks.length,
    playbookProductTypes: payload.playbookProductTypes.length,
    referenceImages: payload.referenceImages.length,
    nameplateGuideImages: payload.nameplateGuideImages.length,
    clearanceGuideImages: payload.clearanceGuideImages.length,
    evidenceGuideImages: payload.evidenceGuideImages.length,
    nameplateConfig: payload.nameplateConfig.length,
    clearanceConfig: payload.clearanceConfig.length,
    maintenanceConfig: payload.maintenanceConfig.length,
    diagnosisModeConfig: payload.diagnosisModeConfig.length,
    intentManifest: payload.intentManifest.length,
    machineSpecs: payload.machineSpecs.length,
  };
}

export async function exportKnowledgeBaseSyncBundle(
  outputDir = DEFAULT_KNOWLEDGE_BASE_SYNC_DIR
): Promise<ExportResult> {
  const resolvedOutputDir = path.resolve(outputDir);
  const filesDir = path.join(resolvedOutputDir, FILES_DIR_NAME);
  const existingTables = await getExistingPublicTableNames();
  const missingTables = SYNC_TABLE_NAMES.filter((tableName) => !existingTables.has(tableName));

  await rm(resolvedOutputDir, { recursive: true, force: true });
  await mkdir(filesDir, { recursive: true });

  const [
    rawLabels,
    rawSupportedModels,
    rawProductTypes,
    rawActions,
    rawDocuments,
    rawDocChunks,
    rawPlaybooks,
    rawPlaybookProductTypes,
    rawReferenceImages,
    rawNameplateGuideImages,
    rawClearanceGuideImages,
    rawEvidenceGuideImages,
    rawNameplateConfig,
    rawClearanceConfig,
    rawMaintenanceConfig,
    rawDiagnosisModeConfig,
    rawIntentManifest,
    rawMachineSpecs,
  ] = await Promise.all([
    selectIfTableExists(existingTables, "labels", () => db.select().from(labels)),
    selectIfTableExists(existingTables, "supported_models", () => db.select().from(supportedModels)),
    selectIfTableExists(existingTables, "product_types", () => db.select().from(productTypes)),
    selectIfTableExists(existingTables, "actions", () => db.select().from(actions)),
    selectIfTableExists(existingTables, "documents", () => db.select().from(documents)),
    selectIfTableExists(existingTables, "doc_chunks", () => db.select().from(docChunks)),
    selectIfTableExists(existingTables, "playbooks", () => db.select().from(playbooks)),
    selectIfTableExists(existingTables, "playbook_product_types", () =>
      db.select().from(playbookProductTypes)
    ),
    selectIfTableExists(existingTables, "reference_images", () => db.select().from(referenceImages)),
    selectIfTableExists(existingTables, "nameplate_guide_images", () =>
      db.select().from(nameplateGuideImages)
    ),
    selectIfTableExists(existingTables, "clearance_guide_images", () =>
      db.select().from(clearanceGuideImages)
    ),
    selectIfTableExists(existingTables, "evidence_guide_images", () =>
      db.select().from(evidenceGuideImages)
    ),
    selectIfTableExists(existingTables, "nameplate_config", () => db.select().from(nameplateConfig)),
    selectIfTableExists(existingTables, "clearance_config", () => db.select().from(clearanceConfig)),
    selectIfTableExists(existingTables, "maintenance_config", () =>
      db.select().from(maintenanceConfig)
    ),
    selectIfTableExists(existingTables, "diagnosis_mode_config", () =>
      db.select().from(diagnosisModeConfig)
    ),
    selectIfTableExists(existingTables, "intent_manifest", () => db.select().from(intentManifest)),
    selectIfTableExists(existingTables, "machine_specs", () => db.select().from(machineSpecs)),
  ]);

  const payload: KnowledgeBaseSyncPayload = {
    labels: sortRows(rawLabels, ["id"]),
    supportedModels: sortRows(rawSupportedModels, ["modelNumber", "id"]),
    productTypes: sortRows(rawProductTypes, ["sortOrder", "name", "id"]),
    actions: sortRows(rawActions, ["id"]),
    documents: sortRows(rawDocuments.map(normalizeDocumentRow), ["title", "id"]),
    docChunks: sortRows(rawDocChunks, ["documentId", "chunkIndex", "id"]),
    playbooks: sortRows(rawPlaybooks, ["labelId", "title", "id"]),
    playbookProductTypes: sortRows(rawPlaybookProductTypes, ["playbookId", "productTypeId", "id"]),
    referenceImages: sortRows(rawReferenceImages.map(normalizeImageRow), ["labelId", "id"]),
    nameplateGuideImages: sortRows(rawNameplateGuideImages.map(normalizeImageRow), ["id"]),
    clearanceGuideImages: sortRows(rawClearanceGuideImages.map(normalizeImageRow), ["id"]),
    evidenceGuideImages: sortRows(rawEvidenceGuideImages.map(normalizeImageRow), ["id"]),
    nameplateConfig: sortRows(rawNameplateConfig, ["id"]),
    clearanceConfig: sortRows(rawClearanceConfig, ["id"]),
    maintenanceConfig: sortRows(rawMaintenanceConfig.map(normalizeMaintenanceConfigRow), ["id"]),
    diagnosisModeConfig: sortRows(rawDiagnosisModeConfig, ["id"]),
    intentManifest: sortRows(rawIntentManifest, ["id"]),
    machineSpecs: sortRows(rawMachineSpecs, ["machineModel", "id"]),
  };

  const fileRecords = new Map<string, SyncFileRecord>();

  for (const row of payload.documents) {
    await collectStorageFile(filesDir, fileRecords, row.filePath);
  }
  for (const row of payload.referenceImages) {
    await collectStorageFile(filesDir, fileRecords, row.filePath);
  }
  for (const row of payload.nameplateGuideImages) {
    await collectStorageFile(filesDir, fileRecords, row.filePath);
  }
  for (const row of payload.clearanceGuideImages) {
    await collectStorageFile(filesDir, fileRecords, row.filePath);
  }
  for (const row of payload.evidenceGuideImages) {
    await collectStorageFile(filesDir, fileRecords, row.filePath);
  }
  for (const row of payload.maintenanceConfig) {
    await collectStorageFile(filesDir, fileRecords, row.iconPath);
  }

  const manifest: KnowledgeBaseSyncManifest = {
    bundleType: "knowledge-base",
    version: KNOWLEDGE_BASE_SYNC_VERSION,
    exportedAt: new Date().toISOString(),
    scope:
      "Versionable knowledge-base content plus storage-backed files used by documents and admin content.",
    excludedTables: EXCLUDED_TABLES,
    missingTables,
    tableCounts: getTableCounts(payload),
    files: sortRows(Array.from(fileRecords.values()), ["relativePath"]),
  };

  await writeJsonFile(path.join(resolvedOutputDir, DATA_FILE_NAME), payload);
  await writeJsonFile(path.join(resolvedOutputDir, MANIFEST_FILE_NAME), manifest);

  return {
    outputDir: resolvedOutputDir,
    manifest,
  };
}

async function readManifest(inputDir: string): Promise<KnowledgeBaseSyncManifest> {
  const manifestPath = path.join(inputDir, MANIFEST_FILE_NAME);
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as KnowledgeBaseSyncManifest;
}

async function readPayload(inputDir: string): Promise<KnowledgeBaseSyncPayload> {
  const dataPath = path.join(inputDir, DATA_FILE_NAME);
  const raw = await readFile(dataPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<KnowledgeBaseSyncPayload>;
  return {
    labels: parsed.labels ?? [],
    supportedModels: parsed.supportedModels ?? [],
    productTypes: parsed.productTypes ?? [],
    actions: parsed.actions ?? [],
    documents: parsed.documents ?? [],
    docChunks: parsed.docChunks ?? [],
    playbooks: parsed.playbooks ?? [],
    playbookProductTypes: parsed.playbookProductTypes ?? [],
    referenceImages: parsed.referenceImages ?? [],
    nameplateGuideImages: parsed.nameplateGuideImages ?? [],
    clearanceGuideImages: parsed.clearanceGuideImages ?? [],
    evidenceGuideImages: parsed.evidenceGuideImages ?? [],
    nameplateConfig: parsed.nameplateConfig ?? [],
    clearanceConfig: parsed.clearanceConfig ?? [],
    maintenanceConfig: parsed.maintenanceConfig ?? [],
    diagnosisModeConfig: parsed.diagnosisModeConfig ?? [],
    intentManifest: parsed.intentManifest ?? [],
    machineSpecs: parsed.machineSpecs ?? [],
  };
}

async function validateBundleFiles(inputDir: string, manifest: KnowledgeBaseSyncManifest): Promise<void> {
  for (const file of manifest.files) {
    const bundleFilePath = path.join(inputDir, FILES_DIR_NAME, file.relativePath);
    const buffer = await readFile(bundleFilePath);
    const hash = sha256(buffer);
    if (hash !== file.sha256) {
      throw new Error(`Bundle file hash mismatch for ${file.relativePath}`);
    }
  }
}

async function restoreBundleFiles(inputDir: string, manifest: KnowledgeBaseSyncManifest): Promise<void> {
  await deleteStorageDirectory(UPLOADED_DOCS_DIR);
  await deleteStorageDirectory(REFERENCE_IMAGES_DIR);
  await deleteStorageDirectory(NAMEPLATE_GUIDE_IMAGES_DIR);
  await deleteStorageDirectory(CLEARANCE_GUIDE_IMAGES_DIR);
  await deleteStorageDirectory(EVIDENCE_GUIDE_IMAGES_DIR);
  await deleteStorageDirectory(MAINTENANCE_ICON_DIR);
  await deleteStorageDirectory(DIAGNOSTIC_SESSIONS_DIR);

  for (const file of manifest.files) {
    const bundleFilePath = path.join(inputDir, FILES_DIR_NAME, file.relativePath);
    const buffer = await readFile(bundleFilePath);
    await writeStorageFile(file.relativePath, buffer);
  }
}

export async function importKnowledgeBaseSyncBundle(
  inputDir = DEFAULT_KNOWLEDGE_BASE_SYNC_DIR
): Promise<ImportResult> {
  const resolvedInputDir = path.resolve(inputDir);
  const manifest = await readManifest(resolvedInputDir);
  const payload = await readPayload(resolvedInputDir);
  const existingTables = await getExistingPublicTableNames();
  const skippedTargetTables = SYNC_TABLE_NAMES.filter((tableName) => !existingTables.has(tableName));

  if (manifest.bundleType !== "knowledge-base") {
    throw new Error(`Unsupported bundle type: ${manifest.bundleType}`);
  }
  if (manifest.version !== KNOWLEDGE_BASE_SYNC_VERSION) {
    throw new Error(
      `Unsupported bundle version ${manifest.version}. Expected ${KNOWLEDGE_BASE_SYNC_VERSION}.`
    );
  }

  await validateBundleFiles(resolvedInputDir, manifest);
  await restoreBundleFiles(resolvedInputDir, manifest);

  const importedDocuments = payload.documents.map((row) =>
    hydrateDateFields(
      {
        ...row,
        filePath: restoreStoredFilePath(row.filePath),
      },
      [
        "queuedAt",
        "ingestionStartedAt",
        "ingestionCompletedAt",
        "createdAt",
      ]
    )
  );

  const importedDocChunks = payload.docChunks.map((row) =>
    hydrateDateFields(row, ["createdAt"])
  );

  const importedReferenceImages = payload.referenceImages.map((row) =>
    hydrateDateFields(
      {
        ...row,
        filePath: restoreStoredFilePath(row.filePath),
      },
      ["createdAt"]
    )
  );

  const importedNameplateGuideImages = payload.nameplateGuideImages.map((row) =>
    hydrateDateFields(
      {
        ...row,
        filePath: restoreStoredFilePath(row.filePath),
      },
      ["createdAt"]
    )
  );

  const importedClearanceGuideImages = payload.clearanceGuideImages.map((row) =>
    hydrateDateFields(
      {
        ...row,
        filePath: restoreStoredFilePath(row.filePath),
      },
      ["createdAt"]
    )
  );

  const importedEvidenceGuideImages = payload.evidenceGuideImages.map((row) =>
    hydrateDateFields(
      {
        ...row,
        filePath: restoreStoredFilePath(row.filePath),
      },
      ["createdAt"]
    )
  );

  const importedMaintenanceConfig = payload.maintenanceConfig.map((row) =>
    hydrateDateFields(
      {
        ...row,
        iconPath: row.iconPath ? restoreStoredFilePath(row.iconPath) : null,
      },
      ["updatedAt"]
    )
  );

  const importedNameplateConfig = payload.nameplateConfig.map((row) =>
    hydrateDateFields(row, ["updatedAt"])
  );

  const importedClearanceConfig = payload.clearanceConfig.map((row) =>
    hydrateDateFields(row, ["updatedAt"])
  );

  const importedDiagnosisModeConfig = payload.diagnosisModeConfig.map((row) =>
    hydrateDateFields(row, ["updatedAt"])
  );

  const importedIntentManifest = payload.intentManifest.map((row) =>
    hydrateDateFields(row, ["updatedAt"])
  );

  const importedMachineSpecs = payload.machineSpecs.map((row) =>
    hydrateDateFields(row, ["createdAt", "updatedAt"])
  );

  const importedLabels = payload.labels.map((row) => hydrateDateFields(row, ["createdAt"]));
  const importedSupportedModels = payload.supportedModels.map((row) =>
    hydrateDateFields(row, ["createdAt"])
  );
  const importedProductTypes = payload.productTypes.map((row) =>
    hydrateDateFields(row, ["createdAt"])
  );
  const importedActions = payload.actions.map((row) =>
    hydrateDateFields(row, ["createdAt", "updatedAt"])
  );
  const importedPlaybooks = payload.playbooks.map((row) =>
    hydrateDateFields(row, ["updatedAt"])
  );

  await db.transaction(async (tx) => {
    await tx.delete(diagnosticSessions);
    await tx.delete(supportSessions);

    await deleteIfTableExists(existingTables, tx, "playbook_product_types", playbookProductTypes);
    await deleteIfTableExists(existingTables, tx, "doc_chunks", docChunks);
    await deleteIfTableExists(existingTables, tx, "machine_specs", machineSpecs);
    await deleteIfTableExists(existingTables, tx, "reference_images", referenceImages);
    await deleteIfTableExists(existingTables, tx, "nameplate_config", nameplateConfig);
    await deleteIfTableExists(existingTables, tx, "clearance_config", clearanceConfig);
    await deleteIfTableExists(existingTables, tx, "playbooks", playbooks);
    await deleteIfTableExists(existingTables, tx, "nameplate_guide_images", nameplateGuideImages);
    await deleteIfTableExists(existingTables, tx, "clearance_guide_images", clearanceGuideImages);
    await deleteIfTableExists(existingTables, tx, "evidence_guide_images", evidenceGuideImages);
    await deleteIfTableExists(existingTables, tx, "maintenance_config", maintenanceConfig);
    await deleteIfTableExists(existingTables, tx, "diagnosis_mode_config", diagnosisModeConfig);
    await deleteIfTableExists(existingTables, tx, "intent_manifest", intentManifest);
    await deleteIfTableExists(existingTables, tx, "documents", documents);
    await deleteIfTableExists(existingTables, tx, "actions", actions);
    await deleteIfTableExists(existingTables, tx, "supported_models", supportedModels);
    await deleteIfTableExists(existingTables, tx, "product_types", productTypes);
    await deleteIfTableExists(existingTables, tx, "labels", labels);

    await insertIfTableExists(existingTables, tx, "labels", labels, importedLabels, 200);
    await insertIfTableExists(
      existingTables,
      tx,
      "supported_models",
      supportedModels,
      importedSupportedModels,
      200
    );
    await insertIfTableExists(existingTables, tx, "product_types", productTypes, importedProductTypes, 200);
    await insertIfTableExists(existingTables, tx, "actions", actions, importedActions, 100);
    await insertIfTableExists(existingTables, tx, "documents", documents, importedDocuments, 100);
    await insertIfTableExists(existingTables, tx, "doc_chunks", docChunks, importedDocChunks, 50);
    await insertIfTableExists(existingTables, tx, "playbooks", playbooks, importedPlaybooks, 100);
    await insertIfTableExists(
      existingTables,
      tx,
      "playbook_product_types",
      playbookProductTypes,
      payload.playbookProductTypes,
      200
    );
    await insertIfTableExists(
      existingTables,
      tx,
      "reference_images",
      referenceImages,
      importedReferenceImages,
      100
    );
    await insertIfTableExists(
      existingTables,
      tx,
      "nameplate_guide_images",
      nameplateGuideImages,
      importedNameplateGuideImages,
      100
    );
    await insertIfTableExists(
      existingTables,
      tx,
      "clearance_guide_images",
      clearanceGuideImages,
      importedClearanceGuideImages,
      100
    );
    await insertIfTableExists(
      existingTables,
      tx,
      "evidence_guide_images",
      evidenceGuideImages,
      importedEvidenceGuideImages,
      100
    );
    await insertIfTableExists(existingTables, tx, "nameplate_config", nameplateConfig, importedNameplateConfig, 20);
    await insertIfTableExists(
      existingTables,
      tx,
      "clearance_config",
      clearanceConfig,
      importedClearanceConfig,
      20
    );
    await insertIfTableExists(
      existingTables,
      tx,
      "maintenance_config",
      maintenanceConfig,
      importedMaintenanceConfig,
      20
    );
    await insertIfTableExists(
      existingTables,
      tx,
      "diagnosis_mode_config",
      diagnosisModeConfig,
      importedDiagnosisModeConfig,
      20
    );
    await insertIfTableExists(existingTables, tx, "intent_manifest", intentManifest, importedIntentManifest, 20);
    await insertIfTableExists(existingTables, tx, "machine_specs", machineSpecs, importedMachineSpecs, 100);
  });

  return {
    inputDir: resolvedInputDir,
    manifest,
    skippedTargetTables,
  };
}
