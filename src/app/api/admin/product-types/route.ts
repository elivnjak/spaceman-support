import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { productTypes } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler() {
  const rows = await db
    .select()
    .from(productTypes)
    .orderBy(asc(productTypes.sortOrder), asc(productTypes.name));
  return NextResponse.json(rows);
}

async function POSTHandler(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    isOther?: boolean;
    sortOrder?: number;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [maxRow] = await db
    .select({ sortOrder: productTypes.sortOrder })
    .from(productTypes)
    .orderBy(desc(productTypes.sortOrder))
    .limit(1);
  const nextOrder = maxRow ? maxRow.sortOrder + 1 : 0;

  const [created] = await db
    .insert(productTypes)
    .values({
      name,
      isOther: Boolean(body.isOther),
      sortOrder: nextOrder,
    })
    .onConflictDoNothing({ target: productTypes.name })
    .returning();

  return NextResponse.json({ created: created ?? null });
}

async function PATCHHandler(request: Request) {
  const body = (await request.json()) as { order?: string[] };
  const order = Array.isArray(body.order) ? body.order : [];
  if (order.length === 0) {
    return NextResponse.json({ error: "order array is required" }, { status: 400 });
  }

  for (let i = 0; i < order.length; i++) {
    const id = String(order[i] ?? "").trim();
    if (!id) continue;
    await db
      .update(productTypes)
      .set({ sortOrder: i })
      .where(eq(productTypes.id, id));
  }
  return NextResponse.json({ ok: true });
}

async function DELETEHandler(request: Request) {
  const body = (await request.json()) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(productTypes)
    .where(eq(productTypes.id, id))
    .returning({ id: productTypes.id });

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/product-types", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/product-types", POSTHandler);

export const PATCH = withApiRouteErrorLogging("/api/admin/product-types", PATCHHandler);

export const DELETE = withApiRouteErrorLogging("/api/admin/product-types", DELETEHandler);
