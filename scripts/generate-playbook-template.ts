import ExcelJS from "exceljs";
import path from "path";

const LIGHT_BLUE: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6EAF8" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const EXAMPLE_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  color: { argb: "FF888888" },
};

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  instruction: string,
  columns: { header: string; key: string; width: number }[],
  exampleRow: Record<string, string>,
  validations?: Record<string, string[]>,
) {
  const ws = wb.addWorksheet(name);

  // Row 1: merged instruction banner
  ws.mergeCells(1, 1, 1, columns.length);
  const instrCell = ws.getCell(1, 1);
  instrCell.value = instruction;
  instrCell.fill = LIGHT_BLUE;
  instrCell.font = { size: 11 };
  instrCell.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(1).height = 40;

  // Row 2: column headers
  columns.forEach((col, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = col.header;
    cell.font = HEADER_FONT;
  });

  // Set column widths
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

  // Row 3: example row
  const exRow = ws.getRow(3);
  columns.forEach((col, i) => {
    const cell = exRow.getCell(i + 1);
    cell.value = exampleRow[col.key] ?? "";
    cell.font = EXAMPLE_FONT;
  });

  // Data validation dropdowns (rows 3–100)
  if (validations) {
    for (const [key, allowed] of Object.entries(validations)) {
      const colIdx = columns.findIndex((c) => c.key === key);
      if (colIdx < 0) continue;
      for (let row = 3; row <= 100; row++) {
        ws.getCell(row, colIdx + 1).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${allowed.join(",")}"`],
          showErrorMessage: true,
          errorTitle: "Invalid value",
          error: `Must be one of: ${allowed.join(", ")}`,
        };
      }
    }
  }

  return ws;
}

async function main() {
  const wb = new ExcelJS.Workbook();

  // --- Overview ---
  addSheet(
    wb,
    "Overview",
    'Fill in playbook_id (blank=create new, set UUID=update existing), title and label_id. Optional: scope by product_type_ids (comma-separated UUIDs) or product_type_names (comma-separated names). Leave product type columns blank for all.',
    [
      { header: "playbook_id", key: "playbook_id", width: 40 },
      { header: "title", key: "title", width: 40 },
      { header: "label_id", key: "label_id", width: 30 },
      { header: "product_type_ids", key: "product_type_ids", width: 52 },
      { header: "product_type_names", key: "product_type_names", width: 40 },
    ],
    {
      playbook_id: "",
      title: "Fix too runny texture",
      label_id: "too_runny",
      product_type_ids: "",
      product_type_names: "Gelato base",
    },
  );

  // --- Symptoms ---
  addSheet(
    wb,
    "Symptoms",
    "List the symptoms a user might describe that would trigger this playbook. One symptom per row. Leave the id blank to auto-generate.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 60 },
    ],
    { id: "watery_output", description: "Product comes out watery or too thin" },
  );

  // --- Evidence ---
  addSheet(
    wb,
    "Evidence",
    'Evidence the assistant should collect during diagnosis. "type" must be one of the dropdown values. Set "required" to yes or no. "action_id" is optional and should match an ID in Admin -> Actions.',
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 50 },
      { header: "action_id", key: "action_id", width: 25 },
      { header: "type", key: "type", width: 18 },
      { header: "required", key: "required", width: 12 },
    ],
    {
      id: "hopper_temp",
      description: "Current hopper temperature reading",
      action_id: "read_hopper_temp",
      type: "reading",
      required: "yes",
    },
    {
      type: ["photo", "reading", "observation", "action", "confirmation"],
      required: ["yes", "no"],
    },
  );

  // --- Causes ---
  addSheet(
    wb,
    "Causes",
    'Possible root causes the assistant will try to narrow down. "ruling_evidence" is a comma-separated list of evidence IDs from the Evidence sheet.',
    [
      { header: "id", key: "id", width: 25 },
      { header: "cause", key: "cause", width: 50 },
      { header: "likelihood", key: "likelihood", width: 14 },
      { header: "ruling_evidence", key: "ruling_evidence", width: 40 },
    ],
    {
      id: "hopper_too_warm",
      cause: "Hopper temperature too high — product not cold enough to set",
      likelihood: "high",
      ruling_evidence: "hopper_temp",
    },
    { likelihood: ["high", "medium", "low"] },
  );

  // --- Questions ---
  addSheet(
    wb,
    "Questions",
    'Diagnostic questions the assistant can ask the user. "when_to_ask" and "action_id" are optional. If set, "action_id" must match an ID in Admin -> Actions.',
    [
      { header: "id", key: "id", width: 25 },
      { header: "question", key: "question", width: 50 },
      { header: "purpose", key: "purpose", width: 40 },
      { header: "when_to_ask", key: "when_to_ask", width: 30 },
      { header: "action_id", key: "action_id", width: 25 },
    ],
    {
      id: "ask_temp",
      question: "What temperature does the hopper display show?",
      purpose: "Determine if hopper is within operating range",
      when_to_ask: "When user reports runny product",
      action_id: "read_hopper_temp",
    },
  );

  // --- Triggers ---
  addSheet(
    wb,
    "Triggers",
    "Escalation triggers — if the user mentions one of these, the assistant should stop diagnosing and escalate to a person.",
    [
      { header: "trigger", key: "trigger", width: 30 },
      { header: "reason", key: "reason", width: 50 },
    ],
    {
      trigger: "smell of burning",
      reason: "Possible electrical fault — needs immediate on-site inspection",
    },
  );

  // --- Steps ---
  addSheet(
    wb,
    "Steps",
    'Resolution steps the user should follow once a cause is identified. Row order = step order. "check" and "if_failed" are optional.',
    [
      { header: "title", key: "title", width: 30 },
      { header: "instruction", key: "instruction", width: 55 },
      { header: "check", key: "check", width: 35 },
      { header: "if_failed", key: "if_failed", width: 35 },
    ],
    {
      title: "Lower hopper temperature",
      instruction: "Set the hopper temperature to -8°C using the control panel.",
      check: "Confirm display shows -8°C after 30 seconds",
      if_failed: "If temperature does not drop, power-cycle the machine",
    },
  );

  const outPath = path.resolve(__dirname, "..", "data", "playbook-template.xlsx");
  await wb.xlsx.writeFile(outPath);
  console.log(`Template written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
