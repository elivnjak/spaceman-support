import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { requireAdminUiAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { deleteDiagnosticSessionStorage } from "@/lib/storage";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function POSTHandler(request: Request) {
  const authError = await requireAdminUiAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const rawIds = (body as { sessionIds?: unknown }).sessionIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "sessionIds array required." }, { status: 400 });
  }

  const sessionIds = Array.from(
    new Set(
      rawIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

  if (sessionIds.length === 0) {
    return NextResponse.json(
      { error: "At least one valid session ID is required." },
      { status: 400 }
    );
  }

  const existingSessions = await db
    .select({ id: diagnosticSessions.id })
    .from(diagnosticSessions)
    .where(inArray(diagnosticSessions.id, sessionIds));

  const existingIds = existingSessions.map((session) => session.id);
  if (existingIds.length === 0) {
    return NextResponse.json({ error: "No matching tickets found." }, { status: 404 });
  }

  const storageResults = await Promise.allSettled(
    existingIds.map((sessionId) => deleteDiagnosticSessionStorage(sessionId))
  );
  const failedSessionIds = storageResults.flatMap((result, index) =>
    result.status === "rejected" ? [existingIds[index]] : []
  );

  if (failedSessionIds.length > 0) {
    console.error("Failed to delete ticket files for sessions:", failedSessionIds);
    return NextResponse.json(
      {
        error: "Failed to delete files for one or more tickets.",
        failedSessionIds,
      },
      { status: 500 }
    );
  }

  await db.delete(diagnosticSessions).where(inArray(diagnosticSessions.id, existingIds));
  const existingIdSet = new Set(existingIds);

  return NextResponse.json({
    ok: true,
    deleted: existingIds.length,
    notFound: sessionIds.filter((id) => !existingIdSet.has(id)),
  });
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/tickets/bulk-delete",
  POSTHandler
);
