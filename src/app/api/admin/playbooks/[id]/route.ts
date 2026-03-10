import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { diagnosticSessions, playbooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { requireAdminUiAuth } from "@/lib/auth";

async function PATCHHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const body = (await request.json()) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const [updated] = await db
    .update(playbooks)
    .set({ enabled: body.enabled, updatedAt: new Date() })
    .where(eq(playbooks.id, id))
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

  try {
    const deleted = await db.transaction(async (tx) => {
      await tx
        .update(diagnosticSessions)
        .set({ playbookId: null, updatedAt: new Date() })
        .where(eq(diagnosticSessions.playbookId, id));

      const [row] = await tx
        .delete(playbooks)
        .where(eq(playbooks.id, id))
        .returning({ id: playbooks.id });

      return row;
    });

    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error: message || "Delete failed",
      },
      { status: 409 }
    );
  }
}

export const PATCH = withApiRouteErrorLogging("/api/admin/playbooks/[id]", PATCHHandler);
export const DELETE = withApiRouteErrorLogging("/api/admin/playbooks/[id]", DELETEHandler);
