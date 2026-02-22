import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supportedModels } from "@/lib/db/schema";
import { toCanonicalModel } from "@/lib/ingestion/extract-machine-model";

export async function GET() {
  const rows = await db
    .select()
    .from(supportedModels)
    .orderBy(asc(supportedModels.modelNumber));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json() as {
    modelNumber?: string;
    displayName?: string;
    models?: string[];
  };

  const single = body.modelNumber ? [body.modelNumber] : [];
  const bulk = Array.isArray(body.models) ? body.models : [];
  const rawModels = [...single, ...bulk];
  const canonicalModels = Array.from(
    new Set(rawModels.map((value) => toCanonicalModel(value)).filter((value): value is string => Boolean(value)))
  );

  if (canonicalModels.length === 0) {
    return NextResponse.json({ error: "At least one valid model number is required." }, { status: 400 });
  }

  const rowsToInsert = canonicalModels.map((model) => ({
    modelNumber: model,
    displayName: body.displayName?.trim() || null,
  }));

  const inserted = await db
    .insert(supportedModels)
    .values(rowsToInsert)
    .onConflictDoNothing({ target: supportedModels.modelNumber })
    .returning();

  return NextResponse.json({ inserted });
}

export async function DELETE(request: Request) {
  const body = await request.json() as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const [deleted] = await db
    .delete(supportedModels)
    .where(eq(supportedModels.id, id))
    .returning({ id: supportedModels.id });

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
