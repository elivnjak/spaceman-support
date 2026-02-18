import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { diagnosticSessions } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const list = await db
    .select({
      id: diagnosticSessions.id,
      status: diagnosticSessions.status,
      phase: diagnosticSessions.phase,
      turnCount: diagnosticSessions.turnCount,
      machineModel: diagnosticSessions.machineModel,
      createdAt: diagnosticSessions.createdAt,
    })
    .from(diagnosticSessions)
    .orderBy(desc(diagnosticSessions.updatedAt))
    .limit(50);
  return NextResponse.json(list);
}
