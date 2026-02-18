import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { INGESTION_CONFIG } from "@/lib/config";

export type TextItemWithPosition = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type PdfTextItem = { str: string; transform?: number[]; width?: number; height?: number };

export type PageText = {
  pageNum: number;
  text: string;
  items: TextItemWithPosition[];
};

/**
 * Extract text and positional items from a PDF buffer using pdfjs-dist (per-page).
 * Used for deterministic text extraction, page-level routing, and numeric verification.
 * pdfjs-dist is externalized in next.config so it loads un-bundled at runtime.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PageText[]> {
  const getDocument = pdfjs.getDocument;

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const result: PageText[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const items = (textContent.items as PdfTextItem[]).filter(
      (item): item is PdfTextItem => "str" in item && typeof item.str === "string"
    );
    const withPosition: TextItemWithPosition[] = items.map((it) => ({
      str: it.str,
      transform: Array.isArray(it.transform) ? [...it.transform] : [],
      width: it.width ?? 0,
      height: it.height ?? 0,
    }));
    const text = reconstructTextFromItems(withPosition);
    result.push({
      pageNum: i,
      text,
      items: withPosition,
    });
    page.cleanup?.();
  }

  await doc.destroy();
  return result;
}

/**
 * Extract x-coordinate from a PDF transform matrix (index 4 is tx).
 * Items in the same column share similar x.
 */
function getX(item: TextItemWithPosition): number {
  const t = item.transform;
  return t && t.length >= 5 ? t[4] : 0;
}

/**
 * Extract y-coordinate from a PDF transform matrix (index 5 is ty).
 * PDF origin is bottom-left; higher y = higher on page.
 */
function getY(item: TextItemWithPosition): number {
  const t = item.transform;
  return t && t.length >= 6 ? t[5] : 0;
}

/**
 * Derive approximate font size from transform scale or item height.
 * Transform indices 0 and 3 are scale factors; height is often present on the item.
 */
function getFontSize(item: TextItemWithPosition): number {
  if (item.height && item.height > 0) return item.height;
  const t = item.transform;
  if (t && t.length >= 4) {
    const scaleY = t[3];
    return Math.abs(scaleY) || 12;
  }
  return 12;
}

/**
 * Reconstruct page text in reading order using item positions.
 * Sorts by Y (top first) then X (left to right), groups into lines by Y proximity,
 * inserts spaces only when there is a meaningful horizontal gap, and joins lines with newlines.
 */
function reconstructTextFromItems(items: TextItemWithPosition[]): string {
  const filtered = items.filter((it) => it.str.trim().length > 0);
  if (filtered.length === 0) return "";

  const sorted = [...filtered].sort((a, b) => {
    const ya = getY(a);
    const yb = getY(b);
    if (Math.abs(ya - yb) > 0.5) return yb - ya;
    return getX(a) - getX(b);
  });

  const fontSizes = sorted.map(getFontSize);
  const medianFontSize =
    fontSizes.length > 0
      ? [...fontSizes].sort((a, b) => a - b)[Math.floor(fontSizes.length / 2)] ?? 12
      : 12;
  const lineTolerance = Math.max(2, medianFontSize * 0.6);

  const lines: TextItemWithPosition[][] = [];
  let currentLine: TextItemWithPosition[] = [];
  let currentY: number | null = null;

  for (const item of sorted) {
    const y = getY(item);
    if (currentY === null || Math.abs(y - currentY) <= lineTolerance) {
      currentLine.push(item);
      if (currentY === null) currentY = y;
    } else {
      if (currentLine.length > 0) {
        currentLine.sort((a, b) => getX(a) - getX(b));
        lines.push(currentLine);
      }
      currentLine = [item];
      currentY = y;
    }
  }
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => getX(a) - getX(b));
    lines.push(currentLine);
  }

  const avgCharWidth =
    filtered.reduce((sum, it) => sum + (it.width || 0), 0) /
    Math.max(1, filtered.reduce((sum, it) => sum + it.str.length, 0));
  const spaceThreshold = Math.max(avgCharWidth * 0.3, 1);

  const lineStrings = lines.map((lineItems) => {
    const parts: string[] = [];
    let prevEnd = -1;
    for (const it of lineItems) {
      const x = getX(it);
      const w = it.width ?? 0;
      const gap = prevEnd >= 0 ? x - prevEnd : 0;
      if (gap > spaceThreshold && parts.length > 0) parts.push(" ");
      parts.push(it.str);
      prevEnd = x + w;
    }
    return parts.join("").trim();
  });

  const joined = lineStrings.join("\n");
  return joined.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Score a page (0–1) for "table-heavy" vs "narrative".
 * Higher score = more likely to be tables/diagrams; send to vision.
 */
export function scorePageAsTableHeavy(page: PageText): number {
  const { items, text } = page;
  if (items.length === 0) return 0;

  const words = text.split(/\s+/).filter(Boolean);
  const totalChars = text.length;

  // Short fragment ratio: table cells are often 1–5 words
  const shortFragments = items.filter((it) => {
    const w = it.str.trim().split(/\s+/).filter(Boolean).length;
    return w <= 5 && it.str.trim().length > 0;
  }).length;
  const shortRatio = shortFragments / items.length;

  // Numeric token density: numbers, decimals, ranges like 220-240
  const numericPattern = /\d+(?:\.\d+)?(?:\s*[\/\-]\s*\d+)?/g;
  const numericMatches = text.match(numericPattern) ?? [];
  const numericChars = numericMatches.join("").length;
  const numericDensity = totalChars > 0 ? numericChars / totalChars : 0;

  // Vertical alignment: cluster x-coordinates (columns)
  const xs = items.map(getX).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return shortRatio * 0.5 + numericDensity * 0.5;
  const sorted = [...xs].sort((a, b) => a - b);
  const tolerance = 15;
  let clusters = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! > tolerance) clusters++;
  }
  const columnScore = Math.min(1, clusters / 8); // many columns -> table

  // Low text density (few chars per item) can indicate sparse table layout
  const charsPerItem = items.length > 0 ? totalChars / items.length : 0;
  const lowDensityScore = charsPerItem < 15 ? 0.8 : charsPerItem < 30 ? 0.5 : 0.2;

  const score =
    shortRatio * 0.3 + numericDensity * 0.3 + columnScore * 0.2 + lowDensityScore * 0.2;
  return Math.min(1, Math.max(0, score));
}

/**
 * Returns which page numbers (1-based) are considered table-heavy and should
 * be sent to vision extraction.
 */
export function getTableHeavyPageNumbers(pages: PageText[]): number[] {
  const threshold = INGESTION_CONFIG.tablePageThreshold;
  return pages
    .filter((p) => scorePageAsTableHeavy(p) >= threshold)
    .map((p) => p.pageNum);
}

/**
 * Full text of the document (all pages concatenated), for fallback chunking.
 */
export function getFullTextFromPages(pages: PageText[]): string {
  return pages.map((p) => p.text).join("\n\n");
}
