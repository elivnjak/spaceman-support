import { readFile, rm, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import { ensureBackupDirectories, getRestoreLockPath } from "./paths";

export type RestoreLockState = {
  active: true;
  operationId: string;
  backupId: string;
  backupName: string;
  startedAt: string;
  message: string;
};

const RESTORE_LOCK_STATUS = 503;

function isAllowedBackupRead(pathname: string, method: string): boolean {
  if (!pathname.startsWith("/api/admin/backups")) return false;
  return method === "GET" || method === "HEAD";
}

export function isMutatingHttpMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export async function readRestoreLock(): Promise<RestoreLockState | null> {
  try {
    const parsed = JSON.parse(await readFile(getRestoreLockPath(), "utf8")) as RestoreLockState;
    return parsed.active ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeRestoreLock(lock: RestoreLockState): Promise<void> {
  await ensureBackupDirectories();
  await writeFile(getRestoreLockPath(), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function clearRestoreLock(): Promise<void> {
  await rm(getRestoreLockPath(), { force: true });
}

export async function buildRestoreLockApiResponse(
  pathname: string,
  method: string
): Promise<NextResponse | null> {
  const lock = await readRestoreLock();
  if (!lock) return null;
  if (!isMutatingHttpMethod(method)) return null;
  if (isAllowedBackupRead(pathname, method)) return null;

  return NextResponse.json(
    {
      error: "A restore is currently in progress. Please wait for it to finish.",
      restoreLock: lock,
    },
    { status: RESTORE_LOCK_STATUS }
  );
}

export async function buildRestoreLockChatResponse(): Promise<NextResponse | null> {
  const lock = await readRestoreLock();
  if (!lock) return null;

  return NextResponse.json(
    {
      error: "A restore is currently in progress. Chat is temporarily unavailable.",
      restoreLock: lock,
    },
    { status: RESTORE_LOCK_STATUS }
  );
}
