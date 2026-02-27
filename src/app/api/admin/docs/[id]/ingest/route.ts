import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  ingestDocument,
  ingestPastedText,
  ingestUrl,
} from "@/lib/ingestion/document-ingestor";
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
    if (pastedText) {
      await ingestPastedText(id, pastedText);
    } else if (doc.filePath === "_pasted" || doc.pastedContent) {
      await ingestPastedText(id);
    } else if (doc.filePath === "_url" && doc.sourceUrl) {
      await ingestUrl(id);
    } else {
      await ingestDocument(id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiRouteErrorLogging("/api/admin/docs/[id]/ingest", POSTHandler);
