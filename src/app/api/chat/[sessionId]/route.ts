import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { getSessionFromRequest } from "@/lib/auth";

function redactMessageEscalationReasons(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const message = { ...(entry as Record<string, unknown>) };
    if (
      message.role === "assistant" &&
      Object.prototype.hasOwnProperty.call(message, "escalation_reason")
    ) {
      delete message.escalation_reason;
    }
    return message;
  });
}

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const authSession = await getSessionFromRequest(request);
  const [session] = await db
    .select()
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId));
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!authSession) {
    return NextResponse.json({
      ...session,
      escalationReason: null,
      escalationHandoff: null,
      messages: redactMessageEscalationReasons(session.messages),
    });
  }
  return NextResponse.json(session);
}

export const GET = withApiRouteErrorLogging("/api/chat/[sessionId]", GETHandler);
