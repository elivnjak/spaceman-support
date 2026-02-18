import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const [session] = await db
    .select()
    .from(diagnosticSessions)
    .where(eq(diagnosticSessions.id, sessionId));
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(session);
}
