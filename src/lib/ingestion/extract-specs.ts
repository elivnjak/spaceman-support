/**
 * Build a structured specs object from vision markdown for storage in machine_specs.
 * Parses sections (##) and markdown tables into a JSON-serializable object.
 */

export type ExtractedSpecs = Record<string, unknown>;

/**
 * Parse markdown into a minimal structured object: section titles as keys,
 * table rows as arrays of key-value objects, or paragraph text as strings.
 */
export function extractSpecsFromMarkdown(markdown: string): ExtractedSpecs {
  const result: ExtractedSpecs = {};
  const lines = markdown.split("\n");
  let currentSection = "content";
  let currentTableHeader: string[] = [];
  let currentTableRows: Record<string, string>[] = [];
  let currentParagraph: string[] = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(" ").trim();
      if (text) {
        if (!result[currentSection]) result[currentSection] = [];
        (result[currentSection] as unknown[]).push({ type: "text", value: text });
      }
      currentParagraph = [];
    }
  }

  function flushTable() {
    if (currentTableRows.length > 0 && currentTableHeader.length > 0) {
      if (!result[currentSection]) result[currentSection] = [];
      (result[currentSection] as unknown[]).push({
        type: "table",
        headers: currentTableHeader,
        rows: currentTableRows,
      });
    }
    currentTableHeader = [];
    currentTableRows = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flushTable();
      flushParagraph();
      currentSection = headingMatch[1].trim().replace(/\s+/g, "_");
      continue;
    }
    if (line.match(/^\s*<!--\s*page\s+\d+\s*-->\s*$/i)) continue;

    const pipeCount = (line.match(/\|/g) ?? []).length;
    if (pipeCount >= 2) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length > 0) {
        if (/^[-:\s]+$/.test(cells.join(""))) continue;
        if (currentTableHeader.length === 0) {
          currentTableHeader = cells;
        } else {
          const row: Record<string, string> = {};
          cells.forEach((val, j) => {
            row[currentTableHeader[j] ?? `col_${j}`] = val;
          });
          currentTableRows.push(row);
        }
      }
      continue;
    }

    flushTable();
    if (line.trim()) currentParagraph.push(line.trim());
  }
  flushTable();
  flushParagraph();

  return result;
}
