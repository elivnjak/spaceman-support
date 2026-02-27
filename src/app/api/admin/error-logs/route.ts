import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth";
import {
  ERROR_LOG_RETENTION_DAYS,
  type ErrorLogLevel,
  queryErrorLogs,
  summarizeErrorLogsBySession,
} from "@/lib/error-logs";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const DEFAULT_LIMIT = 5000;

function parseLevel(value: string | null): ErrorLogLevel | undefined {
  if (value === "error" || value === "warn" || value === "info") return value;
  return undefined;
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(5000, Math.floor(parsed)));
}

async function GETHandler(request: Request) {
  const unauth = await requireAdminAuth(request);
  if (unauth) return unauth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || null;
  const sessionId = searchParams.get("sessionId")?.trim() || null;
  const level = parseLevel(searchParams.get("level"));
  const limit = parseLimit(searchParams.get("limit"));

  const entries = await queryErrorLogs({
    search: q,
    sessionId,
    level,
    limit,
  });

  return NextResponse.json({
    retentionDays: ERROR_LOG_RETENTION_DAYS,
    entries,
    summary: summarizeErrorLogsBySession(entries),
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/error-logs", GETHandler);
