import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { intentManifest } from "@/lib/db/schema";
import { MANIFEST_DEFAULTS, MANIFEST_META } from "./defaults";
import {
  type IntentManifest,
  type IntentManifestOverride,
  type IntentManifestMeta,
  intentManifestOverrideSchema,
  intentManifestSchema,
} from "./types";

const MANIFEST_ROW_ID = "default";
const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  value: IntentManifest;
  expiresAt: number;
};

let cache: CacheEntry | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingIntentManifestTableError(error: unknown): boolean {
  if (!isPlainObject(error)) return false;
  const code = error.code;
  const message = error.message;
  return (
    code === "42P01" &&
    typeof message === "string" &&
    message.toLowerCase().includes("intent_manifest")
  );
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

async function loadOverrideFromDb(): Promise<IntentManifestOverride | null> {
  let row:
    | {
        data: unknown;
      }
    | undefined;
  try {
    [row] = await db
      .select({ data: intentManifest.data })
      .from(intentManifest)
      .where(eq(intentManifest.id, MANIFEST_ROW_ID))
      .limit(1);
  } catch (error) {
    if (isMissingIntentManifestTableError(error)) {
      console.warn(
        "[intent-manifest] Table intent_manifest does not exist; using defaults. Run DB migrations to enable overrides."
      );
      return null;
    }
    throw error;
  }

  if (!row) return null;
  const parsed = intentManifestOverrideSchema.safeParse(row.data);
  if (!parsed.success) {
    console.warn(
      "[intent-manifest] Invalid override payload in DB, ignoring override and using defaults."
    );
    return null;
  }
  return parsed.data;
}

export async function getIntentManifest(
  options?: { bypassCache?: boolean }
): Promise<IntentManifest> {
  const now = Date.now();
  if (!options?.bypassCache && cache && cache.expiresAt > now) {
    return cache.value;
  }

  const override = await loadOverrideFromDb();
  const merged = deepMerge(MANIFEST_DEFAULTS, override ?? {});
  const parsed = intentManifestSchema.safeParse(merged);
  const resolved = parsed.success ? parsed.data : MANIFEST_DEFAULTS;

  if (!parsed.success) {
    console.warn(
      "[intent-manifest] Merged manifest failed validation, falling back to defaults."
    );
  }

  cache = {
    value: resolved,
    expiresAt: now + CACHE_TTL_MS,
  };
  return resolved;
}

export function getIntentManifestMeta(): IntentManifestMeta {
  return MANIFEST_META;
}

export function invalidateIntentManifestCache(): void {
  cache = null;
}

export const INTENT_MANIFEST_ROW_ID = MANIFEST_ROW_ID;
