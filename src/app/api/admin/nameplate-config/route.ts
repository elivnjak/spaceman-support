import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { nameplateConfig, nameplateGuideImages } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const DEFAULT_INSTRUCTION =
  "Please take a clear photo of the machine name plate. It is usually on the rear or side panel and includes the model and serial number.";

type GuideImage = {
  id: string;
  filePath: string;
  notes: string | null;
  createdAt: Date | null;
};

function toGuidePayload(images: GuideImage[], selectedIds: string[]) {
  const selectedSet = new Set(selectedIds);
  return images.map((img) => ({
    id: img.id,
    url: `/api/nameplate-guide-image/${img.id}`,
    notes: img.notes,
    selected: selectedSet.has(img.id),
  }));
}

async function GETHandler() {
  const [config] = await db.select().from(nameplateConfig).limit(1);
  const guideImages = await db
    .select({
      id: nameplateGuideImages.id,
      filePath: nameplateGuideImages.filePath,
      notes: nameplateGuideImages.notes,
      createdAt: nameplateGuideImages.createdAt,
    })
    .from(nameplateGuideImages)
    .orderBy(asc(nameplateGuideImages.createdAt));

  const selectedIds = Array.isArray(config?.guideImageIds)
    ? config.guideImageIds.filter((v): v is string => typeof v === "string")
    : [];

  return NextResponse.json({
    instructionText: config?.instructionText ?? DEFAULT_INSTRUCTION,
    guideImageIds: selectedIds,
    guideImages: toGuidePayload(guideImages, selectedIds),
  });
}

async function PUTHandler(request: Request) {
  const body = await request.json() as {
    instructionText?: string;
    guideImageIds?: string[];
  };
  const instructionText = (body.instructionText ?? "").trim();
  const guideImageIds = Array.isArray(body.guideImageIds)
    ? Array.from(new Set(body.guideImageIds.filter((v): v is string => typeof v === "string")))
    : [];
  const validGuideIds = guideImageIds.length
    ? (
        await db
          .select({ id: nameplateGuideImages.id })
          .from(nameplateGuideImages)
          .where(inArray(nameplateGuideImages.id, guideImageIds))
      ).map((row) => row.id)
    : [];

  if (!instructionText) {
    return NextResponse.json({ error: "instructionText is required" }, { status: 400 });
  }

  const [existing] = await db.select().from(nameplateConfig).limit(1);
  if (existing) {
    await db
      .update(nameplateConfig)
      .set({
        instructionText,
        guideImageIds: validGuideIds,
        updatedAt: new Date(),
      })
      .where(eq(nameplateConfig.id, existing.id));
  } else {
    await db.insert(nameplateConfig).values({
      instructionText,
      guideImageIds: validGuideIds,
      updatedAt: new Date(),
    });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/nameplate-config", GETHandler);

export const PUT = withApiRouteErrorLogging("/api/admin/nameplate-config", PUTHandler);
