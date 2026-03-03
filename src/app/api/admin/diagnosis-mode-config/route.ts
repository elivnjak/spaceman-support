import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { diagnosisModeConfig } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

async function GETHandler() {
  const [config] = await db.select().from(diagnosisModeConfig).limit(1);
  return NextResponse.json({
    enabled: config?.enabled ?? true,
  });
}

async function PUTHandler(request: Request) {
  const body = (await request.json()) as { enabled?: boolean };
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  if (enabled === undefined) {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const [existing] = await db.select().from(diagnosisModeConfig).limit(1);
  if (existing) {
    await db
      .update(diagnosisModeConfig)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(eq(diagnosisModeConfig.id, existing.id));
  } else {
    await db.insert(diagnosisModeConfig).values({
      enabled,
      updatedAt: new Date(),
    });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/diagnosis-mode-config", GETHandler);
export const PUT = withApiRouteErrorLogging("/api/admin/diagnosis-mode-config", PUTHandler);
