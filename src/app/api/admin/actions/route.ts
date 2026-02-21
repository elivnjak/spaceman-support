import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { actions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ActionPayload } from "@/lib/types/actions";

export async function GET() {
  const list = await db.select().from(actions).orderBy(actions.id);
  return NextResponse.json(list);
}

export async function POST(request: Request) {
  const body = await request.json() as ActionPayload;
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
  const slug = id.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const safety = ["safe", "caution", "technician_only"].includes(safetyLevel)
    ? safetyLevel
    : "safe";
  const normalizedExpectedInput = (() => {
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
        range: hasRange ? { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 100 } : undefined,
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
  })();
  if (normalizedExpectedInput?.type === "enum" && (normalizedExpectedInput.options?.length ?? 0) < 2) {
    return NextResponse.json(
      { error: "Enum expectedInput requires at least 2 options" },
      { status: 400 }
    );
  }

  await db
    .insert(actions)
    .values({
      id: slug,
      title: title.trim(),
      instructions: instructions.trim(),
      expectedInput: normalizedExpectedInput ?? null,
      safetyLevel: safety,
      appliesToModels: Array.isArray(appliesToModels) ? appliesToModels : null,
    })
    .onConflictDoUpdate({
      target: actions.id,
      set: {
        title: title.trim(),
        instructions: instructions.trim(),
        expectedInput: normalizedExpectedInput ?? null,
        safetyLevel: safety,
        appliesToModels: Array.isArray(appliesToModels) ? appliesToModels : null,
        updatedAt: new Date(),
      },
    });

  const [row] = await db.select().from(actions).where(eq(actions.id, slug));
  return NextResponse.json(row ?? { id: slug, title, instructions, expectedInput: normalizedExpectedInput, safetyLevel: safety, appliesToModels });
}
