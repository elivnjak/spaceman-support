import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { intentManifest } from "@/lib/db/schema";
import {
  INTENT_MANIFEST_ROW_ID,
  getIntentManifest,
  invalidateIntentManifestCache,
} from "@/lib/intent/loader";
import {
  type IntentManifestOverride,
  intentManifestOverrideSchema,
} from "@/lib/intent/types";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as T;
  }
  if (!isPlainObject(base)) {
    return (override === undefined ? base : (override as T));
  }
  if (!isPlainObject(override)) {
    return base;
  }

  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseValue = out[key];
    const overrideValue = override[key];
    if (baseValue === undefined) {
      out[key] = overrideValue;
      continue;
    }
    out[key] = deepMerge(baseValue, overrideValue);
  }
  return out as T;
}

async function getCurrentOverride(): Promise<IntentManifestOverride> {
  const [row] = await db
    .select({ data: intentManifest.data })
    .from(intentManifest)
    .where(eq(intentManifest.id, INTENT_MANIFEST_ROW_ID))
    .limit(1);

  if (!row) return {};
  const parsed = intentManifestOverrideSchema.safeParse(row.data);
  return parsed.success ? parsed.data : {};
}

async function GETHandler() {
  const manifest = await getIntentManifest();
  return NextResponse.json({
    generalEscalationMessage: manifest.communication.escalationTone,
    frustrationEscalationIntentMessage:
      manifest.frustrationHandling.escalationIntentMessage,
    noModelNumberEscalationMessage:
      manifest.communication.noModelNumberEscalationMessage,
    telegramEscalationNotificationText:
      manifest.communication.telegramEscalationNotificationText,
  });
}

async function PUTHandler(request: Request) {
  const body = (await request.json()) as {
    generalEscalationMessage?: unknown;
    frustrationEscalationIntentMessage?: unknown;
    noModelNumberEscalationMessage?: unknown;
    telegramEscalationNotificationText?: unknown;
    updatedBy?: unknown;
  };

  const generalEscalationMessage =
    typeof body.generalEscalationMessage === "string"
      ? body.generalEscalationMessage.trim()
      : "";
  const frustrationEscalationIntentMessage =
    typeof body.frustrationEscalationIntentMessage === "string"
      ? body.frustrationEscalationIntentMessage.trim()
      : "";
  const noModelNumberEscalationMessage =
    typeof body.noModelNumberEscalationMessage === "string"
      ? body.noModelNumberEscalationMessage.trim()
      : "";
  const telegramEscalationNotificationText =
    typeof body.telegramEscalationNotificationText === "string"
      ? body.telegramEscalationNotificationText.trim()
      : "";

  if (
    !generalEscalationMessage ||
    !frustrationEscalationIntentMessage ||
    !noModelNumberEscalationMessage ||
    !telegramEscalationNotificationText
  ) {
    return NextResponse.json(
      {
        error:
          "generalEscalationMessage, frustrationEscalationIntentMessage, noModelNumberEscalationMessage, and telegramEscalationNotificationText are required.",
      },
      { status: 400 }
    );
  }

  const [currentOverride, existingRow] = await Promise.all([
    getCurrentOverride(),
    db
      .select({ id: intentManifest.id })
      .from(intentManifest)
      .where(eq(intentManifest.id, INTENT_MANIFEST_ROW_ID))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const escalationOverride: IntentManifestOverride = {
    communication: {
      escalationTone: generalEscalationMessage,
      noModelNumberEscalationMessage,
      telegramEscalationNotificationText,
    },
    frustrationHandling: {
      escalationIntentMessage: frustrationEscalationIntentMessage,
    },
  };
  const mergedOverride = deepMerge(currentOverride, escalationOverride);
  const updatedBy =
    typeof body.updatedBy === "string" && body.updatedBy.trim()
      ? body.updatedBy.trim()
      : "admin";

  if (existingRow) {
    await db
      .update(intentManifest)
      .set({
        data: mergedOverride,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(intentManifest.id, INTENT_MANIFEST_ROW_ID));
  } else {
    await db.insert(intentManifest).values({
      id: INTENT_MANIFEST_ROW_ID,
      data: mergedOverride,
      updatedBy,
      updatedAt: new Date(),
    });
  }

  invalidateIntentManifestCache();
  return NextResponse.json({ ok: true });
}

export const GET = withApiRouteErrorLogging(
  "/api/admin/escalation-config",
  GETHandler
);

export const PUT = withApiRouteErrorLogging(
  "/api/admin/escalation-config",
  PUTHandler
);
