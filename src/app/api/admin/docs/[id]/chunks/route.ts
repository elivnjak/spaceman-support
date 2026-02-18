import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { docChunks } from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(_request.url);
  const search = searchParams.get("search")?.trim();

  const conditions = search
    ? and(eq(docChunks.documentId, id), ilike(docChunks.content, `%${search}%`))
    : eq(docChunks.documentId, id);

  const list = await db
    .select()
    .from(docChunks)
    .where(conditions)
    .orderBy(docChunks.chunkIndex);

  return NextResponse.json(list);
}
