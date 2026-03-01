import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSessionFromRequest, hasAdminUiAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions, ticketNotes } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const MAX_NOTE_LENGTH = 5000;

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function POSTHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const authSession = await getSessionFromRequest(request);
  if (!authSession || !hasAdminUiAccess(authSession.user.role)) {
    return unauthorizedResponse();
  }

  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const content =
    typeof (body as { content?: unknown }).content === "string"
      ? (body as { content: string }).content.trim()
      : "";

  if (!content) {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }
  if (content.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `content must be ${MAX_NOTE_LENGTH} characters or less.` },
      { status: 400 }
    );
  }

  const [existingSession] = await db
    .select({ id: diagnosticSessions.id })
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);

  if (!existingSession) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const [inserted] = await db
    .insert(ticketNotes)
    .values({
      sessionId,
      authorId: authSession.user.id,
      content,
    })
    .returning({
      id: ticketNotes.id,
      sessionId: ticketNotes.sessionId,
      authorId: ticketNotes.authorId,
      content: ticketNotes.content,
      createdAt: ticketNotes.createdAt,
    });

  return NextResponse.json(
    {
      ...inserted,
      authorEmail: authSession.user.email,
    },
    { status: 201 }
  );
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/tickets/[sessionId]/notes",
  POSTHandler
);
