import type { PageText } from "./pdf-text-extractor";

/** Matches numbers: integers, decimals, ranges (220-240), fractions (480 / 18.9), with optional trailing units */
const NUMERIC_PATTERN =
  /\d+(?:\.\d+)?(?:\s*[\/\-]\s*(?:\d+(?:\.\d+)?))?(?:\s*(?:mm|in|kg|lb|kW|A|V|CBM|CBF|qt|L|g|hr|Hz|\"|'))?/gi;

/**
 * Extract normalized numeric tokens from text for comparison.
 * Sorts and dedupes so order doesn't matter.
 */
export function extractNumericTokens(text: string): string[] {
  const matches = text.match(NUMERIC_PATTERN) ?? [];
  const normalized = matches.map((m) => m.trim().replace(/\s+/g, " "));
  return [...new Set(normalized)].sort();
}

export type VerificationStatus = "verified" | "unverified" | "mismatch";

export type VerificationResult = {
  status: VerificationStatus;
  /** Human-readable detail for mismatch (e.g. which values differed). */
  detail?: string;
};

/**
 * Compare numeric tokens from vision markdown against deterministic text for the
 * given pages. Used to catch LLM transcription errors on spec values.
 */
export function verifyNumerics(
  visionMarkdown: string,
  pages: PageText[],
  pageNumbersProcessed: number[]
): VerificationResult {
  const visionTokens = extractNumericTokens(visionMarkdown);
  if (visionTokens.length === 0) {
    return { status: "unverified", detail: "No numeric tokens in vision output" };
  }

  const deterministicText = pages
    .filter((p) => pageNumbersProcessed.includes(p.pageNum))
    .map((p) => p.text)
    .join(" ");
  const deterministicTokens = extractNumericTokens(deterministicText);

  if (deterministicTokens.length === 0) {
    return { status: "unverified", detail: "No numeric tokens in deterministic text" };
  }

  const deterministicSet = new Set(deterministicTokens);
  const missing: string[] = [];
  const extra: string[] = [];

  for (const t of visionTokens) {
    if (!deterministicSet.has(t)) {
      missing.push(t);
    }
  }
  const visionSet = new Set(visionTokens);
  for (const t of deterministicTokens) {
    if (!visionSet.has(t)) {
      extra.push(t);
    }
  }

  if (missing.length === 0 && extra.length === 0) {
    return { status: "verified" };
  }

  const detail =
    missing.length > 0
      ? `Vision values not in PDF: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "..." : ""}`
      : "";
  const extraDetail =
    extra.length > 0
      ? ` PDF values missing in vision: ${extra.slice(0, 10).join(", ")}${extra.length > 10 ? "..." : ""}`
      : "";
  return {
    status: "mismatch",
    detail: (detail + extraDetail).trim(),
  };
}
