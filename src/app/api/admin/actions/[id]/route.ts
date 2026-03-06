import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { actions, playbooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdminUiAuth } from "@/lib/auth";
import type { ActionPayload } from "@/lib/types/actions";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function playbooksReferenceAction(playbooksList: { evidenceChecklist: unknown }[], actionId: string): boolean {
  for (const p of playbooksList) {
    const list = p.evidenceChecklist as { actionId?: string }[] | null;
    if (!Array.isArray(list)) continue;
    if (list.some((item) => item?.actionId === actionId)) return true;
  }
  return false;
}

function normalizeExpectedInput(expectedInput: ActionPayload["expectedInput"]) {
  if (!expectedInput?.type) return null;
  const expectedType = expectedInput.type.toLowerCase();
  if (expectedType === "photo") return { type: "photo" as const };
  if (expectedType === "number") {
    const min = expectedInput.range?.min;
    const max = expectedInput.range?.max;
    const hasRange = Number.isFinite(min) || Number.isFinite(max);
    return {
      type: "number" as const,
      unit: expectedInput.unit?.trim() || undefined,
      range: hasRange
        ? { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 100 }
        : undefined,
    };
  }
  if (expectedType === "boolean" || expectedType === "bool") {
    return {
      type: "boolean" as const,
      options:
        expectedInput.options?.map((o) => o.trim()).filter(Boolean).length
          ? expectedInput.options.map((o) => o.trim()).filter(Boolean)
          : ["Yes", "No"],
    };
  }
  if (expectedType === "enum") {
    const options = expectedInput.options?.map((o) => o.trim()).filter(Boolean) ?? [];
    return { type: "enum" as const, options };
  }
  return { type: "text" as const };
}

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Action id required" }, { status: 400 });
  }

  const [row] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}

async function PATCHHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Action id required" }, { status: 400 });
  }

  const body = (await request.json()) as {
    title?: string;
    instructions?: string;
    expectedInput?: ActionPayload["expectedInput"];
    safetyLevel?: string;
    appliesToModels?: string[] | null;
  };
  if (!body.title?.trim() || !body.instructions?.trim()) {
    return NextResponse.json(
      { error: "title and instructions are required" },
      { status: 400 }
    );
  }

  const safety = ["safe", "caution", "technician_only"].includes(body.safetyLevel ?? "")
    ? (body.safetyLevel as ActionPayload["safetyLevel"])
    : "safe";
  const normalizedExpectedInput = normalizeExpectedInput(body.expectedInput);
  if (normalizedExpectedInput?.type === "enum" && (normalizedExpectedInput.options?.length ?? 0) < 2) {
    return NextResponse.json(
      { error: "Enum expectedInput requires at least 2 options" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(actions)
    .set({
      title: body.title.trim(),
      instructions: body.instructions.trim(),
      expectedInput: normalizedExpectedInput ?? null,
      safetyLevel: safety,
      appliesToModels: Array.isArray(body.appliesToModels) ? body.appliesToModels : null,
      updatedAt: new Date(),
    })
    .where(eq(actions.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

async function DELETEHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const playbooksList = await db
    .select({ evidenceChecklist: playbooks.evidenceChecklist })
    .from(playbooks);
  if (playbooksReferenceAction(playbooksList, id)) {
    return NextResponse.json(
      { error: "Action is referenced by one or more playbooks. Remove references first." },
      { status: 409 }
    );
  }
  const [deleted] = await db
    .delete(actions)
    .where(eq(actions.id, id))
    .returning({ id: actions.id });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/actions/[id]", GETHandler);
export const PATCH = withApiRouteErrorLogging("/api/admin/actions/[id]", PATCHHandler);
export const DELETE = withApiRouteErrorLogging("/api/admin/actions/[id]", DELETEHandler);
