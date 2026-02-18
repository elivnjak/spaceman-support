import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { labels } from "@/lib/db/schema";

export async function GET() {
  const list = await db.select().from(labels);
  return NextResponse.json(list);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { id, displayName, description } = body as {
    id: string;
    displayName: string;
    description?: string;
  };
  if (!id || !displayName) {
    return NextResponse.json(
      { error: "id and displayName required" },
      { status: 400 }
    );
  }
  const slug = id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  await db
    .insert(labels)
    .values({
      id: slug,
      displayName,
      description: description ?? null,
    })
    .onConflictDoUpdate({
      target: labels.id,
      set: { displayName, description: description ?? null },
    });
  return NextResponse.json({ id: slug, displayName, description: description ?? null });
}
