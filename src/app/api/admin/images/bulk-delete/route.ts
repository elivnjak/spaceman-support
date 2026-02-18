import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceImages } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export async function POST(request: Request) {
  const body = await request.json();
  const { ids } = body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "ids array required" },
      { status: 400 }
    );
  }
  await db.delete(referenceImages).where(inArray(referenceImages.id, ids));
  return NextResponse.json({ ok: true, deleted: ids.length });
}
