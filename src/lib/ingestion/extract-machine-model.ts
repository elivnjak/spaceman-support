/**
 * Extract and normalize machine model identifiers from document content.
 * Models may appear with "SM-" prefix (e.g. SM-6210-C) or without (6210-C);
 * both are treated as the same model. We store and match using the canonical
 * form without the prefix so that "people usually refer without the prefix".
 *
 * Auto-extraction uses two strategies:
 * 1. Explicit SM- prefix in free text (e.g. SM-6210-C) — high confidence.
 * 2. Context-based: "For Models:" / "Models:" followed by a list where bare
 *    numbers like 6210-C are accepted.
 * This avoids matching random numbers, dates, or page numbers.
 */

/**
 * Matches model identifiers with an explicit SM- prefix (3+ digits, optional
 * dash-suffixes). E.g. SM-6210-C, SM-6220.
 */
const SM_PREFIX_PATTERN = /\bSM-(\d{3,}[A-Z]?(?:-[A-Z0-9]+)*)\b/gi;

/**
 * Matches a "For Models:" / "Model:" / "Models:" header followed by the
 * rest of the line, so we can extract model numbers from that context.
 */
const MODELS_CONTEXT_PATTERN = /\b(?:for\s+)?models?\s*:\s*([^\n]+)/gi;

/**
 * Inside a known models-list context, match model numbers with or without
 * SM- prefix (3+ digits required to avoid incidental numbers).
 */
const MODEL_IN_LIST_PATTERN = /\b(?:SM-)?(\d{3,}[A-Z]?(?:-[A-Z0-9]+)*)\b/gi;

/**
 * Normalize a model string to canonical form (without SM- prefix).
 * Used for storage and for matching so both "SM-6210-C" and "6210-C" match the same document.
 */
export function toCanonicalModel(value: string | null | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.replace(/^SM-/i, "").trim();
  return withoutPrefix || null;
}

/**
 * Extract all unique machine models from document text.
 *
 * Strategy:
 * 1. Scan for explicit SM-XXXX patterns anywhere in the text.
 * 2. Scan for "Models:" / "For Models:" lines and extract model numbers
 *    (with or without SM- prefix) from those lines.
 *
 * Returns canonical forms (no SM- prefix) in order of first occurrence.
 * If none found, returns [].
 */
export function extractMachineModelFromText(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const seen = new Set<string>();
  const order: string[] = [];

  function addModel(canonical: string) {
    const c = canonical.trim();
    if (c.length >= 3 && !seen.has(c)) {
      seen.add(c);
      order.push(c);
    }
  }

  // 1. Explicit SM- prefixed models from free text
  let match: RegExpExecArray | null;
  const smRe = new RegExp(SM_PREFIX_PATTERN.source, "gi");
  while ((match = smRe.exec(text)) !== null) {
    addModel(match[1] ?? "");
  }

  // 2. Models from "For Models:" / "Models:" context lines
  const ctxRe = new RegExp(MODELS_CONTEXT_PATTERN.source, "gi");
  while ((match = ctxRe.exec(text)) !== null) {
    const listText = match[1] ?? "";
    const listRe = new RegExp(MODEL_IN_LIST_PATTERN.source, "gi");
    let listMatch: RegExpExecArray | null;
    while ((listMatch = listRe.exec(listText)) !== null) {
      addModel(listMatch[1] ?? "");
    }
  }

  return order;
}

/**
 * Join extracted models for storage in documents.machine_model (comma-separated).
 */
export function formatMachineModelsForStorage(models: string[]): string | null {
  const trimmed = models.map((m) => m.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed.join(", ") : null;
}
