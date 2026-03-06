import { NextResponse } from "next/server";
import { and, count, desc, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { labels } from "@/lib/db/schema";
import { requireAdminUiAuth } from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

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

function normalizeLabelId(id: string): string {
  return id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

async function GETHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize");
  const usePagination = pageRaw !== null || pageSizeRaw !== null;

  const filters: SQL<unknown>[] = [];
  if (q) {
    const pattern = `%${q}%`;
    filters.push(or(ilike(labels.id, pattern), ilike(labels.displayName, pattern))!);
  }
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  if (!usePagination) {
    const list = await db
      .select()
      .from(labels)
      .where(whereClause)
      .orderBy(labels.displayName);
    return NextResponse.json(list);
  }

  const page = parsePositiveInt(pageRaw, DEFAULT_PAGE, 1, 1_000_000);
  const pageSize = parsePositiveInt(pageSizeRaw, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const [countRow] = await db.select({ total: count(labels.id) }).from(labels).where(whereClause);
  const total = Number(countRow?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const items = await db
    .select()
    .from(labels)
    .where(whereClause)
    .orderBy(desc(labels.createdAt), labels.displayName)
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    items,
    page: safePage,
    pageSize,
    total,
    totalPages,
  });
}

async function POSTHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const body = await request.json();
  const { id, displayName, description } = body as {
    id: string;
    displayName: string;
    description?: string;
  };
  if (!id || !displayName) {
    return NextResponse.json(
      { error: "id and displayName required" },
      { status: 400 }
    );
  }
  const slug = normalizeLabelId(id);
  if (!slug) {
    return NextResponse.json(
      { error: "id must contain letters, numbers, or underscores" },
      { status: 400 }
    );
  }

  try {
    const [created] = await db
      .insert(labels)
      .values({
        id: slug,
        displayName: displayName.trim(),
        description: description?.trim() || null,
      })
      .returning();

    return NextResponse.json(created);
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json(
        { error: "A label with this id already exists." },
        { status: 409 }
      );
    }
    throw error;
  }
}

export const GET = withApiRouteErrorLogging("/api/admin/labels", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/labels", POSTHandler);
