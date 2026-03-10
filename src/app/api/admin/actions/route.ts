import { NextResponse } from "next/server";
import { and, count, desc, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { actions } from "@/lib/db/schema";
import { requireAdminUiAuth } from "@/lib/auth";
import type { ActionPayload } from "@/lib/types/actions";
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

function normalizeActionId(id: string): string {
  return id.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function normalizeExpectedInput(expectedInput: ActionPayload["expectedInput"]) {
  if (!expectedInput?.type) {
    return { expectedInput: null, error: null as string | null };
  }
  const expectedType = expectedInput.type.toLowerCase();
  if (expectedType === "photo") return { expectedInput: { type: "photo" as const }, error: null as string | null };
  if (expectedType === "number") {
    const min = expectedInput.range?.min;
    const max = expectedInput.range?.max;
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (hasMin !== hasMax) {
      return {
        expectedInput: null,
        error: "Number expectedInput range requires both min and max.",
      };
    }
    return {
      expectedInput: {
        type: "number" as const,
        unit: expectedInput.unit?.trim() || undefined,
        range: hasMin && hasMax ? { min: Number(min), max: Number(max) } : undefined,
      },
      error: null as string | null,
    };
  }
  if (expectedType === "boolean" || expectedType === "bool") {
    return {
      expectedInput: {
        type: "boolean" as const,
        options:
          expectedInput.options?.map((o) => o.trim()).filter(Boolean).length
            ? expectedInput.options.map((o) => o.trim()).filter(Boolean)
            : ["Yes", "No"],
      },
      error: null as string | null,
    };
  }
  if (expectedType === "enum") {
    const options = expectedInput.options?.map((o) => o.trim()).filter(Boolean) ?? [];
    return { expectedInput: { type: "enum" as const, options }, error: null as string | null };
  }
  return { expectedInput: { type: "text" as const }, error: null as string | null };
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
    filters.push(
      or(
        ilike(actions.id, pattern),
        ilike(actions.title, pattern),
        ilike(actions.instructions, pattern)
      )!
    );
  }
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  if (!usePagination) {
    const list = await db.select().from(actions).where(whereClause).orderBy(actions.id);
    return NextResponse.json(list);
  }

  const page = parsePositiveInt(pageRaw, DEFAULT_PAGE, 1, 1_000_000);
  const pageSize = parsePositiveInt(pageSizeRaw, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const [countRow] = await db.select({ total: count(actions.id) }).from(actions).where(whereClause);
  const total = Number(countRow?.total ?? 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  const items = await db
    .select()
    .from(actions)
    .where(whereClause)
    .orderBy(desc(actions.updatedAt), actions.id)
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

  const body = (await request.json()) as ActionPayload;
  const {
    id,
    title,
    instructions,
    expectedInput,
    safetyLevel = "safe",
    appliesToModels,
  } = body;
  if (!id?.trim() || !title?.trim() || !instructions?.trim()) {
    return NextResponse.json(
      { error: "id, title, and instructions are required" },
      { status: 400 }
    );
  }
  const slug = normalizeActionId(id);
  if (!slug) {
    return NextResponse.json(
      { error: "id must contain letters, numbers, or underscores" },
      { status: 400 }
    );
  }
  const safety = ["safe", "caution", "technician_only"].includes(safetyLevel)
    ? safetyLevel
    : "safe";
  const { expectedInput: normalizedExpectedInput, error } = normalizeExpectedInput(expectedInput);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  if (normalizedExpectedInput?.type === "enum" && (normalizedExpectedInput.options?.length ?? 0) < 2) {
    return NextResponse.json(
      { error: "Enum expectedInput requires at least 2 options" },
      { status: 400 }
    );
  }

  try {
    const [inserted] = await db
      .insert(actions)
      .values({
        id: slug,
        title: title.trim(),
        instructions: instructions.trim(),
        expectedInput: normalizedExpectedInput ?? null,
        safetyLevel: safety,
        appliesToModels: Array.isArray(appliesToModels) ? appliesToModels : null,
      })
      .returning();
    return NextResponse.json(inserted);
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json(
        { error: "An action with this id already exists." },
        { status: 409 }
      );
    }
    throw error;
  }
}

export const GET = withApiRouteErrorLogging("/api/admin/actions", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/actions", POSTHandler);
