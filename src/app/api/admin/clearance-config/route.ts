import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { clearanceConfig, clearanceGuideImages } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const DEFAULT_INSTRUCTION =
  "Please send photos of the machine clearance from different angles so our technical team can review installation spacing if escalation is needed.";

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
    url: `/api/clearance-guide-image/${img.id}`,
    notes: img.notes,
    selected: selectedSet.has(img.id),
  }));
}

async function GETHandler() {
  const [config] = await db.select().from(clearanceConfig).limit(1);
  const guideImages = await db
    .select({
      id: clearanceGuideImages.id,
      filePath: clearanceGuideImages.filePath,
      notes: clearanceGuideImages.notes,
      createdAt: clearanceGuideImages.createdAt,
    })
    .from(clearanceGuideImages)
    .orderBy(asc(clearanceGuideImages.createdAt));

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
  const body = (await request.json()) as {
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
          .select({ id: clearanceGuideImages.id })
          .from(clearanceGuideImages)
          .where(inArray(clearanceGuideImages.id, guideImageIds))
      ).map((row) => row.id)
    : [];

  if (!instructionText) {
    return NextResponse.json({ error: "instructionText is required" }, { status: 400 });
  }

  const [existing] = await db.select().from(clearanceConfig).limit(1);
  if (existing) {
    await db
      .update(clearanceConfig)
      .set({
        instructionText,
        guideImageIds: validGuideIds,
        updatedAt: new Date(),
      })
      .where(eq(clearanceConfig.id, existing.id));
  } else {
    await db.insert(clearanceConfig).values({
      instructionText,
      guideImageIds: validGuideIds,
      updatedAt: new Date(),
    });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging("/api/admin/clearance-config", GETHandler);

export const PUT = withApiRouteErrorLogging("/api/admin/clearance-config", PUTHandler);
