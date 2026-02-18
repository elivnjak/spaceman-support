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

  await db
    .insert(actions)
    .values({
      id: slug,
      title: title.trim(),
      instructions: instructions.trim(),
      expectedInput: expectedInput ?? null,
      safetyLevel: safety,
      appliesToModels: Array.isArray(appliesToModels) ? appliesToModels : null,
    })
    .onConflictDoUpdate({
      target: actions.id,
      set: {
        title: title.trim(),
        instructions: instructions.trim(),
        expectedInput: expectedInput ?? null,
        safetyLevel: safety,
        appliesToModels: Array.isArray(appliesToModels) ? appliesToModels : null,
        updatedAt: new Date(),
      },
    });

  const [row] = await db.select().from(actions).where(eq(actions.id, slug));
  return NextResponse.json(row ?? { id: slug, title, instructions, expectedInput, safetyLevel: safety, appliesToModels });
}
