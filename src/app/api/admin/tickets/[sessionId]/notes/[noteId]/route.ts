import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionFromRequest, hasAdminUiAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { ticketNotes } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function DELETEHandler(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ sessionId: string; noteId: string }>;
  }
) {
  const authSession = await getSessionFromRequest(request);
  if (!authSession || !hasAdminUiAccess(authSession.user.role)) {
    return unauthorizedResponse();
  }

  const { sessionId, noteId } = await params;

  const [existingNote] = await db
    .select({
      id: ticketNotes.id,
      authorId: ticketNotes.authorId,
    })
    .from(ticketNotes)
    .where(and(eq(ticketNotes.id, noteId), eq(ticketNotes.sessionId, sessionId)))
    .limit(1);

  if (!existingNote) {
    return NextResponse.json({ error: "Note not found." }, { status: 404 });
  }
  if (existingNote.authorId !== authSession.user.id) {
    return NextResponse.json(
      { error: "You can only delete your own notes." },
      { status: 403 }
    );
  }

  await db
    .delete(ticketNotes)
    .where(and(eq(ticketNotes.id, noteId), eq(ticketNotes.sessionId, sessionId)));

  return new NextResponse(null, { status: 204 });
}

export const DELETE = withApiRouteErrorLogging(
  "/api/admin/tickets/[sessionId]/notes/[noteId]",
  DELETEHandler
);
