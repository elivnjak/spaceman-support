import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { intentManifest } from "@/lib/db/schema";
import {
  INTENT_MANIFEST_ROW_ID,
  getIntentManifest,
  getIntentManifestMeta,
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

function collectOverridePaths(
  value: unknown,
  prefix = ""
): string[] {
  if (Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  if (!isPlainObject(value)) {
    return prefix ? [prefix] : [];
  }
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child) || Array.isArray(child)) {
      const nested = collectOverridePaths(child, nextPrefix);
      if (nested.length > 0) paths.push(...nested);
      else paths.push(nextPrefix);
    } else {
      paths.push(nextPrefix);
    }
  }
  return paths;
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
  const meta = getIntentManifestMeta();
  const override = await getCurrentOverride();
  return NextResponse.json({
    manifest,
    metadata: meta,
    override,
    overriddenFields: collectOverridePaths(override),
  });
}

async function PUTHandler(request: Request) {
  const body = (await request.json()) as {
    override?: unknown;
    updatedBy?: string;
  };
  const candidate = body.override ?? body;
  const parsed = intentManifestOverrideSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid intent manifest payload",
        details: parsed.error.flatten(),
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

  const mergedOverride = Object.prototype.hasOwnProperty.call(body, "override")
    ? parsed.data
    : deepMerge(currentOverride, parsed.data);
  const updatedBy =
    typeof body.updatedBy === "string" && body.updatedBy.trim()
      ? body.updatedBy.trim()
      : null;

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
  const manifest = await getIntentManifest({ bypassCache: true });
  return NextResponse.json({
    ok: true,
    manifest,
    override: mergedOverride,
    overriddenFields: collectOverridePaths(mergedOverride),
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/intent-manifest", GETHandler);

export const PUT = withApiRouteErrorLogging("/api/admin/intent-manifest", PUTHandler);
