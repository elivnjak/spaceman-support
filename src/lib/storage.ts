import { createHash } from "crypto";
import { mkdir, writeFile, readFile, unlink, readdir } from "fs/promises";
import path from "path";

const STORAGE_ROOT = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage");

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
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

export function getStorageRelativePath(fullPath: string): string {
  const root = path.resolve(STORAGE_ROOT);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(root)) {
    return path.relative(process.cwd(), resolved);
  }
  return path.relative(root, resolved);
}

export const REFERENCE_IMAGES_DIR = "reference_images";
export const NAMEPLATE_GUIDE_IMAGES_DIR = "nameplate_guide_images";
export const CLEARANCE_GUIDE_IMAGES_DIR = "clearance_guide_images";
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
