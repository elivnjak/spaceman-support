import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maintenanceConfig } from "@/lib/db/schema";
import { readStorageFile } from "@/lib/storage";

export async function GET() {
  const [config] = await db
    .select({ iconPath: maintenanceConfig.iconPath })
    .from(maintenanceConfig)
    .limit(1);
  if (!config?.iconPath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const buffer = await readStorageFile(config.iconPath);
    const ext = config.iconPath.split(".").pop()?.toLowerCase() || "jpg";
    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
