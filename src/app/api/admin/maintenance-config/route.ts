import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { maintenanceConfig } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const DEFAULT_TITLE = "Chat Unavailable";
const DEFAULT_DESCRIPTION =
  "Our support chat is currently undergoing maintenance.";

async function GETHandler() {
  const [config] = await db.select().from(maintenanceConfig).limit(1);
  return NextResponse.json({
    enabled: config?.enabled ?? false,
    iconPath: config?.iconPath ?? null,
    iconUrl: config?.iconPath ? "/api/maintenance-icon" : null,
    title: config?.title ?? DEFAULT_TITLE,
    description: config?.description ?? DEFAULT_DESCRIPTION,
    phone: config?.phone ?? "",
    email: config?.email ?? "",
  });
}

async function PUTHandler(request: Request) {
  const body = (await request.json()) as {
    enabled?: boolean;
    title?: string;
    description?: string;
    phone?: string;
    email?: string;
  };
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
  const title =
    typeof body.title === "string" ? body.title.trim() : undefined;
  const description =
    typeof body.description === "string" ? body.description.trim() : undefined;
  const phone =
    typeof body.phone === "string" ? body.phone.trim() : undefined;
  const email =
    typeof body.email === "string" ? body.email.trim() : undefined;

  const [existing] = await db.select().from(maintenanceConfig).limit(1);
  const updates: {
    enabled?: boolean;
    title?: string;
    description?: string;
    phone?: string;
    email?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (enabled !== undefined) updates.enabled = enabled;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;

  if (existing) {
    await db
      .update(maintenanceConfig)
      .set(updates)
      .where(eq(maintenanceConfig.id, existing.id));
  } else {
    await db.insert(maintenanceConfig).values({
      enabled: updates.enabled ?? false,
      title: updates.title ?? DEFAULT_TITLE,
      description: updates.description ?? DEFAULT_DESCRIPTION,
      phone: updates.phone ?? "",
      email: updates.email ?? "",
      updatedAt: updates.updatedAt,
    });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/maintenance-config", GETHandler);

export const PUT = withApiRouteErrorLogging("/api/admin/maintenance-config", PUTHandler);
