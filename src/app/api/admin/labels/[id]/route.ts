import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { labels } from "@/lib/db/schema";
import { requireAdminUiAuth } from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type RouteParams = { params: Promise<{ id: string }> };

async function GETHandler(request: Request, { params }: RouteParams) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Label id required" }, { status: 400 });
  }

  const [label] = await db.select().from(labels).where(eq(labels.id, id)).limit(1);
  if (!label) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  return NextResponse.json(label);
}

async function PATCHHandler(request: Request, { params }: RouteParams) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Label id required" }, { status: 400 });
  }

  const body = (await request.json()) as {
    displayName?: string;
    description?: string | null;
  };

  const displayName = body.displayName?.trim();
  if (!displayName) {
    return NextResponse.json({ error: "displayName required" }, { status: 400 });
  }

  const [updated] = await db
    .update(labels)
    .set({
      displayName,
      description: body.description?.trim() || null,
    })
    .where(eq(labels.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

async function DELETEHandler(request: Request, { params }: RouteParams) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Label id required" }, { status: 400 });
  }

  try {
    const [deleted] = await db.delete(labels).where(eq(labels.id, id)).returning({ id: labels.id });
    if (!deleted) {
      return NextResponse.json({ error: "Label not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: string }).message)
        : "";
    if (
      message.toLowerCase().includes("violates foreign key") ||
      message.toLowerCase().includes("foreign key constraint")
    ) {
      return NextResponse.json(
        {
          error:
            "This label is still referenced by other records and cannot be deleted yet.",
        },
        { status: 409 }
      );
    }
    throw error;
  }
}

export const GET = withApiRouteErrorLogging("/api/admin/labels/[id]", GETHandler);
export const PATCH = withApiRouteErrorLogging("/api/admin/labels/[id]", PATCHHandler);
export const DELETE = withApiRouteErrorLogging("/api/admin/labels/[id]", DELETEHandler);
