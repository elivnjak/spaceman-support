import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import {
  getSessionFromRequest,
  hasAdminUiAccess,
  requireAdminUiAuth,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions, ticketNotes, users } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type TicketStatus = "open" | "in_progress" | "waiting" | "closed";

const TICKET_STATUSES = new Set<TicketStatus>([
  "open",
  "in_progress",
  "waiting",
  "closed",
]);

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const authSession = await getSessionFromRequest(request);
  const { sessionId } = await params;

  const [session] = await db
    .select()
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const notes = await db
    .select({
      id: ticketNotes.id,
      sessionId: ticketNotes.sessionId,
      authorId: ticketNotes.authorId,
      authorEmail: users.email,
      content: ticketNotes.content,
      createdAt: ticketNotes.createdAt,
    })
    .from(ticketNotes)
    .leftJoin(users, eq(ticketNotes.authorId, users.id))
    .where(eq(ticketNotes.sessionId, sessionId))
    .orderBy(desc(ticketNotes.createdAt));

  return NextResponse.json({
    session,
    notes,
    currentUser:
      authSession && hasAdminUiAccess(authSession.user.role)
        ? {
            id: authSession.user.id,
            email: authSession.user.email,
            role: authSession.user.role,
          }
        : null,
  });
}

async function PATCHHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const nextStatus =
    typeof (body as { ticketStatus?: unknown }).ticketStatus === "string"
      ? (body as { ticketStatus: string }).ticketStatus.trim().toLowerCase()
      : "";

  if (!TICKET_STATUSES.has(nextStatus as TicketStatus)) {
    return NextResponse.json(
      { error: "ticketStatus must be open, in_progress, waiting, or closed." },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(diagnosticSessions)
    .set({
      ticketStatus: nextStatus as TicketStatus,
      updatedAt: new Date(),
    })
    .where(eq(diagnosticSessions.id, sessionId))
    .returning({
      id: diagnosticSessions.id,
      ticketStatus: diagnosticSessions.ticketStatus,
      updatedAt: diagnosticSessions.updatedAt,
    });

  if (!updated) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export const GET = withApiRouteErrorLogging(
  "/api/admin/tickets/[sessionId]",
  GETHandler
);
export const PATCH = withApiRouteErrorLogging(
  "/api/admin/tickets/[sessionId]",
  PATCHHandler
);
