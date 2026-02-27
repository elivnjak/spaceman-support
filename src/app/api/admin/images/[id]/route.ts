import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceImages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function PATCHHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await _request.json();
  const { labelId } = body as { labelId?: string };
  if (!labelId) {
    return NextResponse.json(
      { error: "labelId required" },
      { status: 400 }
    );
  }
  const [updated] = await db
    .update(referenceImages)
    .set({ labelId })
    .where(eq(referenceImages.id, id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

async function DELETEHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [deleted] = await db
    .delete(referenceImages)
    .where(eq(referenceImages.id, id))
    .returning({ id: referenceImages.id });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiRouteErrorLogging("/api/admin/images/[id]", PATCHHandler);

export const DELETE = withApiRouteErrorLogging("/api/admin/images/[id]", DELETEHandler);
