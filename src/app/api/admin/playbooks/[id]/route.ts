import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { diagnosticSessions, playbooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function DELETEHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

export const DELETE = withApiRouteErrorLogging("/api/admin/playbooks/[id]", DELETEHandler);
