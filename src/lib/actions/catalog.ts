import fs from "fs";
import path from "path";
import type { ActionSafetyLevel, ExpectedInput, ExpectedInputType } from "@/lib/types/actions";

export type ActionCatalogRow = {
  actionId: string;
  name: string;
  description: string;
  type: "photo" | "reading" | "observation" | "action" | "confirmation";
  expectedInput: ExpectedInput;
  safetyLevel: ActionSafetyLevel;
};

const DEFAULT_OPTIONS_YES_NO = ["Yes", "No"];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    return row;
  });
}

function toNumber(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptions(v: string): string[] | undefined {
  const options = v
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  return options.length > 0 ? options : undefined;
}

function fallbackExpectedInputFromLegacyType(
  type: ActionCatalogRow["type"]
): ExpectedInput {
  if (type === "photo") return { type: "photo" };
  if (type === "reading") return { type: "number" };
  if (type === "confirmation") return { type: "boolean", options: DEFAULT_OPTIONS_YES_NO };
  return { type: "text" };
}

function normalizeExpectedInput(input: ExpectedInput): ExpectedInput {
  const type = input.type.toLowerCase() as ExpectedInputType;
  if (type === "boolean") {
    return {
      type: "boolean",
      options: input.options?.length ? input.options : DEFAULT_OPTIONS_YES_NO,
    };
  }
  if (type === "enum") {
    return {
      type: "enum",
      options: input.options?.map((o) => o.trim()).filter(Boolean) ?? [],
    };
  }
  if (type === "number") {
    return {
      type: "number",
      unit: input.unit?.trim() || undefined,
      range:
        input.range &&
        Number.isFinite(input.range.min) &&
        Number.isFinite(input.range.max)
          ? { min: input.range.min, max: input.range.max }
          : undefined,
    };
  }
  if (type === "photo") return { type: "photo" };
  return { type: "text" };
}

export function loadActionCatalogRows(
  csvPath = path.resolve(process.cwd(), "import_data", "action_catalog.csv")
): ActionCatalogRow[] {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  return rows.map((row) => {
    const type = (row.type || "observation").toLowerCase() as ActionCatalogRow["type"];
    const expectedTypeRaw = (row.expected_input_type || "").toLowerCase();
    const expectedType = (
      expectedTypeRaw === "bool" ? "boolean" : expectedTypeRaw
    ) as ExpectedInputType;
    const min = toNumber(row.expected_input_min ?? "");
    const max = toNumber(row.expected_input_max ?? "");
    const parsedOptions = parseOptions(row.expected_input_options ?? "");
    const expectedInput =
      expectedType === "photo"
        ? { type: "photo" as const }
        : expectedType === "number"
          ? {
              type: "number" as const,
              unit: (row.expected_input_unit || "").trim() || undefined,
              range:
                min != null || max != null
                  ? { min: min ?? 0, max: max ?? 100 }
                  : undefined,
            }
          : expectedType === "boolean"
            ? { type: "boolean" as const, options: parsedOptions?.length ? parsedOptions : DEFAULT_OPTIONS_YES_NO }
            : expectedType === "enum"
              ? { type: "enum" as const, options: parsedOptions ?? [] }
              : expectedType === "text"
                ? { type: "text" as const }
                : fallbackExpectedInputFromLegacyType(type);

    const safetyRaw = (row.safety_level || "safe").toLowerCase();
    const safetyLevel: ActionSafetyLevel =
      safetyRaw === "caution" || safetyRaw === "technician_only" ? safetyRaw : "safe";

    return {
      actionId: row.action_id,
      name: row.name,
      description: row.description,
      type,
      expectedInput: normalizeExpectedInput(expectedInput),
      safetyLevel,
    };
  });
}

export function recommendEvidenceTypeFromExpectedInput(
  expectedInputType: ExpectedInputType,
  currentType: "photo" | "reading" | "observation" | "action" | "confirmation"
): "photo" | "reading" | "observation" | "action" | "confirmation" {
  if (expectedInputType === "photo") return "photo";
  if (expectedInputType === "number") return "reading";
  if (expectedInputType === "boolean") return "confirmation";
  if (currentType === "action") return "action";
  return "observation";
}
