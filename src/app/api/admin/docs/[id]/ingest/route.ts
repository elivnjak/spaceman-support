import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { enqueueDocumentIngestion } from "@/lib/ingestion/ingestion-queue";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function POSTHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await _request.json().catch(() => ({}));
  const pastedText = body.pastedText as string | undefined;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, id),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    const queued = await enqueueDocumentIngestion(id, { pastedText });
    return NextResponse.json(
      {
        ok: true,
        status: queued.status,
      },
      { status: 202 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiRouteErrorLogging("/api/admin/docs/[id]/ingest", POSTHandler);
