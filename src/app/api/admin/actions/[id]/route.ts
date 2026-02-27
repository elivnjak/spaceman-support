import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { actions, playbooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function playbooksReferenceAction(playbooksList: { evidenceChecklist: unknown }[], actionId: string): boolean {
  for (const p of playbooksList) {
    const list = p.evidenceChecklist as { actionId?: string }[] | null;
    if (!Array.isArray(list)) continue;
    if (list.some((item) => item?.actionId === actionId)) return true;
  }
  return false;
}

async function DELETEHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

export const DELETE = withApiRouteErrorLogging("/api/admin/actions/[id]", DELETEHandler);
