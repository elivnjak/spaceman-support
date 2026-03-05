import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { slugFromUrl } from "@/lib/ingestion/document-ingestor";
import {
  extractMachineModelFromText,
  formatMachineModelsForStorage,
} from "@/lib/ingestion/extract-machine-model";
import { enqueueDocumentIngestion } from "@/lib/ingestion/ingestion-queue";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { validateExternalHttpUrl } from "@/lib/url-security";

async function POSTHandler(request: Request) {
  let body: {
    url?: string;
    cssSelector?: string;
    renderJs?: boolean;
    machineModel?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const url = (body.url as string)?.trim();
  if (!url) {
    return NextResponse.json(
      { error: "url is required" },
      { status: 400 }
    );
  }
  const urlValidationError = await validateExternalHttpUrl(url);
  if (urlValidationError) {
    return NextResponse.json(
      { error: `URL is not allowed: ${urlValidationError}` },
      { status: 400 }
    );
  }

  const cssSelector = (body.cssSelector as string)?.trim() || null;
  const renderJs = Boolean(body.renderJs);
  const machineModel = (body.machineModel as string)?.trim() || null;
  const placeholderTitle = slugFromUrl(url);
  const autoMachineModels = formatMachineModelsForStorage(
    extractMachineModelFromText(`${placeholderTitle}\n${url}`)
  );

  const [doc] = await db
    .insert(documents)
    .values({
      title: placeholderTitle,
      filePath: "_url",
      status: "PENDING",
      ingestionProgress: 0,
      ingestionStage: "Queued",
      queuedAt: new Date(),
      rawTextPreview: url.slice(0, 500),
      sourceUrl: url,
      cssSelector,
      renderJs,
      machineModel: machineModel ?? autoMachineModels,
    })
    .returning();

  if (!doc) {
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }

  await enqueueDocumentIngestion(doc.id);
  return NextResponse.json(doc, { status: 202 });
}

export const POST = withApiRouteErrorLogging("/api/admin/docs/ingest-url", POSTHandler);
