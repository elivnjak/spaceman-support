import { appendFile, mkdir, readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import {
  getSessionCookieName,
  getSessionFromRequest,
  requireAdminUiAuth,
  rotateSessionToken,
} from "@/lib/auth";

export type ErrorLogLevel = "error" | "warn" | "info";

export type ErrorLogEntry = {
  id: string;
  timestamp: string;
  level: ErrorLogLevel;
  message: string;
  sessionId: string | null;
  route?: string;
  errorName?: string;
  stack?: string;
  context?: Record<string, unknown>;
};

export type LogErrorInput = {
  level?: ErrorLogLevel;
  message: string;
  sessionId?: string | null;
  route?: string | null;
  error?: unknown;
  stack?: string | null;
  context?: Record<string, unknown> | null;
};

export type QueryErrorLogsOptions = {
  search?: string | null;
  sessionId?: string | null;
  level?: ErrorLogLevel;
  limit?: number;
};

export type ErrorLogSessionSummary = {
  sessionId: string | null;
  logCount: number;
  errorCount: number;
  warnCount: number;
  infoCount: number;
  lastSeenAt: string;
  lastMessage: string;
};

function resolveErrorLogsRoot(): string {
  const explicit = process.env.ERROR_LOGS_PATH?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const storagePath = process.env.STORAGE_PATH?.trim();
  if (storagePath) {
    return path.join(storagePath, "logs");
  }

  const railwayMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (railwayMount) {
    const normalized = railwayMount.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.toLowerCase().endsWith("/logs")) {
      return railwayMount;
    }
    return path.join(railwayMount, "logs");
  }

  return path.join(process.cwd(), "logs");
}

const LOGS_ROOT = resolveErrorLogsRoot();
const LOG_FILE_PREFIX = "errors-";
const LOG_FILE_SUFFIX = ".log";
const MAX_LOG_LIMIT = 5000;
const DEFAULT_LOG_LIMIT = 500;
const CLEANUP_INTERVAL_MS = 1000 * 60 * 15;

export const ERROR_LOG_RETENTION_DAYS = 30;
const ERROR_LOG_RETENTION_MS = ERROR_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let lastCleanupAt = 0;

export function getErrorLogsRoot(): string {
  return LOGS_ROOT;
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeSessionId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseError(error: unknown): { errorName?: string; message?: string; stack?: string } {
  if (!error) return {};
  if (error instanceof Error) {
    return {
      errorName: trimOrUndefined(error.name),
      message: trimOrUndefined(error.message),
      stack: trimOrUndefined(error.stack),
    };
  }
  if (typeof error === "string") {
    return { message: trimOrUndefined(error) };
  }
  try {
    return { message: trimOrUndefined(JSON.stringify(error)) };
  } catch {
    return { message: trimOrUndefined(String(error)) };
  }
}

function getDailyLogFilePath(now: Date): string {
  const datePart = now.toISOString().slice(0, 10);
  return path.join(LOGS_ROOT, `${LOG_FILE_PREFIX}${datePart}${LOG_FILE_SUFFIX}`);
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LOG_LIMIT;
  return Math.max(1, Math.min(MAX_LOG_LIMIT, Math.floor(limit)));
}

function isErrorLogEntry(value: unknown): value is ErrorLogEntry {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<ErrorLogEntry>;
  return (
    typeof maybe.id === "string" &&
    typeof maybe.timestamp === "string" &&
    typeof maybe.level === "string" &&
    typeof maybe.message === "string" &&
    (typeof maybe.sessionId === "string" || maybe.sessionId === null)
  );
}

function matchesSearch(entry: ErrorLogEntry, search: string | null): boolean {
  if (!search) return true;
  const normalized = search.toLowerCase();
  const fields = [
    entry.message,
    entry.sessionId ?? "",
    entry.route ?? "",
    entry.errorName ?? "",
    entry.stack ?? "",
    entry.context ? JSON.stringify(entry.context) : "",
  ];
  return fields.some((field) => field.toLowerCase().includes(normalized));
}

function sortByNewest(entries: ErrorLogEntry[]): ErrorLogEntry[] {
  return entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

async function listLogFilesNewestFirst(): Promise<string[]> {
  const entries = await readdir(LOGS_ROOT, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(LOG_FILE_PREFIX) &&
        entry.name.endsWith(LOG_FILE_SUFFIX)
    )
    .map((entry) => path.join(LOGS_ROOT, entry.name))
    .sort((a, b) => b.localeCompare(a));
}

async function maybeCleanupOldFiles(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  try {
    await cleanupOldErrorLogs(now);
  } catch {
    // Never break request flow when cleanup fails.
  }
}

export async function ensureErrorLogsDir(): Promise<void> {
  await mkdir(LOGS_ROOT, { recursive: true });
}

export async function cleanupOldErrorLogs(nowMs = Date.now()): Promise<number> {
  await ensureErrorLogsDir();
  const cutoff = nowMs - ERROR_LOG_RETENTION_MS;
  const files = await listLogFilesNewestFirst();
  let deleted = 0;

  for (const fullPath of files) {
    try {
      const fileStat = await stat(fullPath);
      if (fileStat.mtimeMs < cutoff) {
        await unlink(fullPath);
        deleted += 1;
      }
    } catch {
      // Ignore races or filesystem errors for individual files.
    }
  }

  return deleted;
}

export async function logErrorEvent(input: LogErrorInput): Promise<ErrorLogEntry> {
  await ensureErrorLogsDir();
  await maybeCleanupOldFiles();

  const parsedError = parseError(input.error);
  const now = new Date();
  const message =
    trimOrUndefined(input.message) ??
    parsedError.message ??
    "Unexpected error";

  const entry: ErrorLogEntry = {
    id: crypto.randomUUID(),
    timestamp: now.toISOString(),
    level: input.level ?? "error",
    message,
    sessionId: normalizeSessionId(input.sessionId),
    route: trimOrUndefined(input.route),
    errorName: parsedError.errorName,
    stack: trimOrUndefined(input.stack) ?? parsedError.stack,
    context: input.context ?? undefined,
  };

  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(getDailyLogFilePath(now), line, "utf8");
  return entry;
}

export async function queryErrorLogs(
  options: QueryErrorLogsOptions = {}
): Promise<ErrorLogEntry[]> {
  await ensureErrorLogsDir();
  await maybeCleanupOldFiles();

  const cutoff = Date.now() - ERROR_LOG_RETENTION_MS;
  const sessionId = normalizeSessionId(options.sessionId);
  const limit = clampLimit(options.limit);
  const files = await listLogFilesNewestFirst();
  const matches: ErrorLogEntry[] = [];

  for (const filePath of files) {
    if (matches.length >= limit) break;
    let content = "";
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (matches.length >= limit) break;
      const line = lines[i]?.trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isErrorLogEntry(parsed)) continue;

      const ts = new Date(parsed.timestamp).getTime();
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      if (sessionId && parsed.sessionId !== sessionId) continue;
      if (options.level && parsed.level !== options.level) continue;
      if (!matchesSearch(parsed, options.search?.trim() || null)) continue;

      matches.push(parsed);
    }
  }

  return sortByNewest(matches).slice(0, limit);
}

export function summarizeErrorLogsBySession(
  entries: ErrorLogEntry[]
): ErrorLogSessionSummary[] {
  const map = new Map<string, ErrorLogSessionSummary>();

  for (const entry of entries) {
    const key = entry.sessionId ?? "__no_session__";
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        sessionId: entry.sessionId,
        logCount: 1,
        errorCount: entry.level === "error" ? 1 : 0,
        warnCount: entry.level === "warn" ? 1 : 0,
        infoCount: entry.level === "info" ? 1 : 0,
        lastSeenAt: entry.timestamp,
        lastMessage: entry.message,
      });
      continue;
    }

    existing.logCount += 1;
    if (entry.level === "error") existing.errorCount += 1;
    if (entry.level === "warn") existing.warnCount += 1;
    if (entry.level === "info") existing.infoCount += 1;
    if (new Date(entry.timestamp).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = entry.timestamp;
      existing.lastMessage = entry.message;
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  return null;
}

function coerceParamsObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

async function extractContextData(args: unknown[]): Promise<{
  method: string | null;
  path: string | null;
  sessionId: string | null;
  params: Record<string, unknown> | null;
}> {
  const request = args[0] as Request | undefined;
  const context = args[1] as
    | { params?: Promise<Record<string, unknown>> | Record<string, unknown> }
    | undefined;

  const method = request?.method ?? null;
  const path = request?.url ? new URL(request.url).pathname : null;
  const paramsValue = context?.params ? await Promise.resolve(context.params) : null;
  const params = coerceParamsObject(paramsValue);

  const sessionId =
    firstString(params?.sessionId) ??
    firstString(params?.id) ??
    (path
      ?.split("/")
      .find((part) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) ??
      null);

  return { method, path, sessionId, params };
}

export function withApiRouteErrorLogging<
  TArgs extends unknown[],
  TResult extends Response | Promise<Response>
>(
  routeName: string,
  handler: (...args: TArgs) => TResult
): (...args: TArgs) => Promise<Response> {
  function buildSessionCookie(token: string, expiresAt: Date): string {
    const parts = [
      `${getSessionCookieName()}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Expires=${expiresAt.toUTCString()}`,
    ];
    if (process.env.NODE_ENV === "production") {
      parts.push("Secure");
    }
    return parts.join("; ");
  }

  const wrapped = async (...args: TArgs): Promise<Response> => {
    const ctx = await extractContextData(args as unknown[]).catch(() => ({
      method: null,
      path: null,
      sessionId: null,
      params: null,
    }));
    let sessionTokenForRotation: string | null = null;

    try {
      if (routeName.startsWith("/api/admin")) {
        const request = args[0] instanceof Request ? args[0] : null;
        if (request) {
          const authError = await requireAdminUiAuth(request);
          if (authError) {
            return authError;
          }

          const session = await getSessionFromRequest(request);
          sessionTokenForRotation = session?.token ?? null;
        }
      }

      const response = await handler(...args);
      if (
        sessionTokenForRotation &&
        response.status < 400 &&
        routeName.startsWith("/api/admin")
      ) {
        const rotated = await rotateSessionToken(sessionTokenForRotation).catch(
          () => null
        );
        if (rotated) {
          response.headers.append(
            "Set-Cookie",
            buildSessionCookie(rotated.token, rotated.expiresAt)
          );
        }
      }

      if (response.status >= 500) {
        await logErrorEvent({
          level: "error",
          route: routeName || ctx.path || undefined,
          sessionId: ctx.sessionId,
          message: `API route returned ${response.status}.`,
          context: {
            method: ctx.method,
            path: ctx.path,
            params: ctx.params,
            status: response.status,
          },
        }).catch(() => {});
      }
      return response;
    } catch (error) {
      await logErrorEvent({
        level: "error",
        route: routeName || ctx.path || undefined,
        sessionId: ctx.sessionId,
        message: `Unhandled API error in ${routeName || "route handler"}.`,
        error,
        context: {
          method: ctx.method,
          path: ctx.path,
          params: ctx.params,
        },
      }).catch(() => {});

      return NextResponse.json(
        { error: "Internal server error." },
        { status: 500 }
      );
    }
  };
  return wrapped;
}
