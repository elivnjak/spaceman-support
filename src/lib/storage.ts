import { createHash } from "crypto";
import { mkdir, writeFile, readFile, unlink, readdir, rm } from "fs/promises";
import path from "path";

const STORAGE_ROOT = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

export function getSafeImageExtension(fileName: string, fallback = "jpg"): string {
  const ext = fileName.split(".").pop()?.trim().toLowerCase() ?? "";
  return ALLOWED_IMAGE_EXTENSIONS.has(ext) ? ext : fallback;
}

export async function writeStorageFile(
  relativePath: string,
  data: Buffer | string
): Promise<string> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  await ensureDir(path.dirname(fullPath));
  await writeFile(fullPath, data);
  return fullPath;
}

export async function readStorageFile(relativePath: string): Promise<Buffer> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  return readFile(fullPath);
}

export async function deleteStorageFile(relativePath: string): Promise<void> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  await unlink(fullPath);
}

export async function deleteStorageDirectory(relativePath: string): Promise<void> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  await rm(fullPath, { recursive: true, force: true });
}

export function getStorageRoot(): string {
  return STORAGE_ROOT;
}

export function resolveStoragePath(relativePath: string): string {
  return path.join(STORAGE_ROOT, relativePath);
}

export function getStorageRelativePath(fullPath: string): string {
  const root = path.resolve(STORAGE_ROOT);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(root)) {
    return path.relative(process.cwd(), resolved);
  }
  return path.relative(root, resolved);
}

export function normalizeStorageRelativePath(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  const root = path.resolve(STORAGE_ROOT).replace(/\\/g, "/");
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  if (resolved === root || resolved.startsWith(`${root}/`)) {
    return path.relative(root, resolved).replace(/\\/g, "/");
  }

  const normalizedInput = filePath.replace(/\\/g, "/");
  const storageSegment = normalizedInput.match(/(?:^|\/)storage\/(.+)$/i);
  if (storageSegment?.[1]) {
    return storageSegment[1].replace(/^\/+/, "");
  }

  return getStorageRelativePath(filePath).replace(/\\/g, "/");
}

export function resolveStoredFilePath(filePath: string): string {
  return resolveStoragePath(normalizeStorageRelativePath(filePath));
}

export const REFERENCE_IMAGES_DIR = "reference_images";
export const NAMEPLATE_GUIDE_IMAGES_DIR = "nameplate_guide_images";
export const CLEARANCE_GUIDE_IMAGES_DIR = "clearance_guide_images";
export const EVIDENCE_GUIDE_IMAGES_DIR = "evidence_guide_images";
export const MAINTENANCE_ICON_DIR = "maintenance_icon";
export const UPLOADED_DOCS_DIR = "documents";

export function referenceImagePath(labelId: string, filename: string): string {
  return path.join(REFERENCE_IMAGES_DIR, labelId, filename);
}

export function nameplateGuideImagePath(filename: string): string {
  return path.join(NAMEPLATE_GUIDE_IMAGES_DIR, filename);
}

export function clearanceGuideImagePath(filename: string): string {
  return path.join(CLEARANCE_GUIDE_IMAGES_DIR, filename);
}

export function evidenceGuideImagePath(filename: string): string {
  return path.join(EVIDENCE_GUIDE_IMAGES_DIR, filename);
}

export function maintenanceIconPath(filename: string): string {
  return path.join(MAINTENANCE_ICON_DIR, filename);
}

export function documentPath(filename: string): string {
  return path.join(UPLOADED_DOCS_DIR, filename);
}

export const DIAGNOSTIC_SESSIONS_DIR = "diagnostic_sessions";

export function diagnosticSessionImagePath(sessionId: string, filename: string): string {
  return path.join(DIAGNOSTIC_SESSIONS_DIR, sessionId, filename);
}

export async function deleteDiagnosticSessionStorage(sessionId: string): Promise<void> {
  await deleteStorageDirectory(path.join(DIAGNOSTIC_SESSIONS_DIR, sessionId));
}
