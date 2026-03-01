import { NextResponse } from "next/server";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { requireAdminUiAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type TicketStatus = "open" | "in_progress" | "waiting" | "closed";
type SessionStatus = "active" | "resolved" | "escalated";

const TICKET_STATUSES = new Set<TicketStatus>([
  "open",
  "in_progress",
  "waiting",
  "closed",
]);
const SESSION_STATUSES = new Set<SessionStatus>([
  "active",
  "resolved",
  "escalated",
]);
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePositiveInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseTicketStatusFilter(value: string | null): TicketStatus | undefined | null {
  if (!value || value === "all") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!TICKET_STATUSES.has(normalized as TicketStatus)) return null;
  return normalized as TicketStatus;
}

function parseSessionStatusFilter(value: string | null): SessionStatus | undefined | null {
  if (!value || value === "all") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!SESSION_STATUSES.has(normalized as SessionStatus)) return null;
  return normalized as SessionStatus;
}

async function GETHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const ticketStatus = parseTicketStatusFilter(searchParams.get("ticketStatus"));
  const sessionStatus = parseSessionStatusFilter(searchParams.get("sessionStatus"));
  const page = parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE, 1, 1_000_000);
  const pageSize = parsePositiveInt(
    searchParams.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );

  if (ticketStatus === null) {
    return NextResponse.json(
      { error: "Invalid ticketStatus filter." },
      { status: 400 }
    );
  }
  if (sessionStatus === null) {
    return NextResponse.json(
      { error: "Invalid sessionStatus filter." },
      { status: 400 }
    );
  }

  const filters: SQL<unknown>[] = [];
  if (ticketStatus) {
    filters.push(eq(diagnosticSessions.ticketStatus, ticketStatus));
  }
  if (sessionStatus) {
    filters.push(eq(diagnosticSessions.status, sessionStatus));
  }
  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(
        ilike(diagnosticSessions.userName, pattern),
        ilike(diagnosticSessions.userPhone, pattern),
        ilike(diagnosticSessions.machineModel, pattern),
        ilike(diagnosticSessions.serialNumber, pattern)
      )!
    );
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [countRow] = await db
    .select({ total: count(diagnosticSessions.id) })
    .from(diagnosticSessions)
    .where(whereClause);
  const total = Number(countRow?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const rows = await db
    .select({
      id: diagnosticSessions.id,
      status: diagnosticSessions.status,
      ticketStatus: diagnosticSessions.ticketStatus,
      phase: diagnosticSessions.phase,
      turnCount: diagnosticSessions.turnCount,
      userName: diagnosticSessions.userName,
      userPhone: diagnosticSessions.userPhone,
      machineModel: diagnosticSessions.machineModel,
      serialNumber: diagnosticSessions.serialNumber,
      productType: diagnosticSessions.productType,
      createdAt: diagnosticSessions.createdAt,
      updatedAt: diagnosticSessions.updatedAt,
    })
    .from(diagnosticSessions)
    .where(whereClause)
    .orderBy(desc(diagnosticSessions.updatedAt))
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    items: rows,
    page: safePage,
    pageSize,
    total,
    totalPages,
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/tickets", GETHandler);
