import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { maintenanceConfig } from "@/lib/db/schema";
import {
  deleteStorageFile,
  maintenanceIconPath,
  sha256,
  writeStorageFile,
} from "@/lib/storage";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "A single image file is required." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)
    ? ext
    : "jpg";
  const filename = `icon_${sha256(buffer).slice(0, 12)}_${Date.now()}.${safeExt}`;
  const relativePath = maintenanceIconPath(filename);
  await writeStorageFile(relativePath, buffer);

  const [existing] = await db.select().from(maintenanceConfig).limit(1);
  if (existing?.iconPath) {
    try {
      await deleteStorageFile(existing.iconPath);
    } catch {
      // ignore if file already missing
    }
  }

  if (existing) {
    await db
      .update(maintenanceConfig)
      .set({ iconPath: relativePath, updatedAt: new Date() })
      .where(eq(maintenanceConfig.id, existing.id));
  } else {
    await db.insert(maintenanceConfig).values({
      enabled: false,
      iconPath: relativePath,
      updatedAt: new Date(),
    });
  }

  return NextResponse.json({ ok: true, iconUrl: "/api/maintenance-icon" });
}

export async function DELETE() {
  const [config] = await db.select().from(maintenanceConfig).limit(1);
  if (!config?.iconPath) {
    return NextResponse.json({ ok: true });
  }
  try {
    await deleteStorageFile(config.iconPath);
  } catch {
    // ignore if file already missing
  }
  await db
    .update(maintenanceConfig)
    .set({ iconPath: null, updatedAt: new Date() })
    .where(eq(maintenanceConfig.id, config.id));
  return NextResponse.json({ ok: true });
}
