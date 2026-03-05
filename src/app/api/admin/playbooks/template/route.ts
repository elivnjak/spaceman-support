import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { actions, labels, productTypes } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

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
const EVIDENCE_TYPES = ["photo", "reading", "observation", "action", "confirmation"];
const LIKELIHOODS = ["high", "medium", "low"];

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  instruction: string,
  columns: { header: string; key: string; width: number }[],
  exampleRow: Record<string, string>,
  validations?: Record<string, string[]>
) {
  const ws = wb.addWorksheet(name);

  ws.mergeCells(1, 1, 1, columns.length);
  const instructionCell = ws.getCell(1, 1);
  instructionCell.value = instruction;
  instructionCell.fill = LIGHT_BLUE;
  instructionCell.font = { size: 11 };
  instructionCell.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(1).height = 44;

  columns.forEach((column, index) => {
    const cell = ws.getCell(2, index + 1);
    cell.value = column.header;
    cell.font = HEADER_FONT;
  });

  ws.columns = columns.map((column) => ({ key: column.key, width: column.width }));

  const exampleExcelRow = ws.getRow(3);
  columns.forEach((column, index) => {
    const cell = exampleExcelRow.getCell(index + 1);
    cell.value = exampleRow[column.key] ?? "";
    cell.font = EXAMPLE_FONT;
  });

  if (validations) {
    for (const [key, allowed] of Object.entries(validations)) {
      const columnIndex = columns.findIndex((column) => column.key === key);
      if (columnIndex < 0) continue;
      for (let row = 3; row <= 300; row += 1) {
        ws.getCell(row, columnIndex + 1).dataValidation = {
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
}

function addReferenceSheet(
  wb: ExcelJS.Workbook,
  labelRows: { id: string; displayName: string | null }[],
  productTypeRows: { id: string; name: string }[],
  actionRows: { id: string; title: string }[]
) {
  const ws = wb.addWorksheet("Reference");
  ws.columns = [
    { header: "Section", key: "section", width: 18 },
    { header: "ID", key: "id", width: 40 },
    { header: "Name / Title", key: "name", width: 56 },
  ];
  ws.getRow(1).font = HEADER_FONT;

  const writeSection = (
    section: string,
    rows: { id: string; name: string }[],
    emptyMessage: string
  ) => {
    if (rows.length === 0) {
      ws.addRow({
        section,
        id: "-",
        name: emptyMessage,
      });
      return;
    }
    for (const row of rows) {
      ws.addRow({
        section,
        id: row.id,
        name: row.name,
      });
    }
  };

  writeSection(
    "Labels",
    labelRows.map((item) => ({ id: item.id, name: item.displayName ?? item.id })),
    "No labels found"
  );
  ws.addRow({});
  writeSection(
    "Product types",
    productTypeRows.map((item) => ({ id: item.id, name: item.name })),
    "No product types found"
  );
  ws.addRow({});
  writeSection(
    "Actions",
    actionRows.map((item) => ({ id: item.id, name: item.title })),
    "No actions found"
  );

  ws.getCell("E1").value =
    "Use IDs from this sheet in label_id/action_id/product_type_ids, or use product type names in product_type_names.";
  ws.getCell("E1").alignment = { wrapText: true };
  ws.getColumn("E").width = 68;
}

async function GETHandler() {
  const [labelRows, productTypeRows, actionRows] = await Promise.all([
    db.select({ id: labels.id, displayName: labels.displayName }).from(labels),
    db.select({ id: productTypes.id, name: productTypes.name }).from(productTypes),
    db.select({ id: actions.id, title: actions.title }).from(actions),
  ]);

  const wb = new ExcelJS.Workbook();
  addSheet(
    wb,
    "Overview",
    'Fill one row only. "playbook_id" blank = create new on import; set it to update an existing playbook. "label_id" is required. Optionally scope with product_type_ids (UUIDs) or product_type_names (names from Reference tab).',
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
    }
  );
  addSheet(
    wb,
    "Symptoms",
    "List user-visible symptoms that should trigger this playbook. Leave id blank to auto-generate.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 64 },
    ],
    { id: "watery_output", description: "Product comes out watery or too thin" }
  );
  addSheet(
    wb,
    "Evidence",
    'Evidence to gather. "action_id" is optional and must exist in Admin -> Actions. Required is yes/no.',
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 50 },
      { header: "action_id", key: "action_id", width: 30 },
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
      type: EVIDENCE_TYPES,
      required: ["yes", "no"],
    }
  );
  addSheet(
    wb,
    "Causes",
    "Possible root causes. ruling_evidence is a comma-separated list of Evidence IDs.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "cause", key: "cause", width: 54 },
      { header: "likelihood", key: "likelihood", width: 14 },
      { header: "ruling_evidence", key: "ruling_evidence", width: 40 },
    ],
    {
      id: "hopper_too_warm",
      cause: "Hopper temperature too high",
      likelihood: "high",
      ruling_evidence: "hopper_temp",
    },
    { likelihood: LIKELIHOODS }
  );
  addSheet(
    wb,
    "Triggers",
    "Escalation triggers. If user mentions this, assistant escalates.",
    [
      { header: "trigger", key: "trigger", width: 30 },
      { header: "reason", key: "reason", width: 60 },
    ],
    {
      trigger: "smell of burning",
      reason: "Possible electrical fault; requires technician",
    }
  );
  addSheet(
    wb,
    "Steps",
    "Resolution steps to follow after diagnosis. Row order is step order.",
    [
      { header: "title", key: "title", width: 30 },
      { header: "instruction", key: "instruction", width: 56 },
      { header: "check", key: "check", width: 36 },
    ],
    {
      title: "Lower hopper temperature",
      instruction: "Set hopper temperature to target range for this product.",
      check: "Confirm display shows target range",
    }
  );
  addReferenceSheet(wb, labelRows, productTypeRows, actionRows);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="playbook-template.xlsx"',
    },
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/playbooks/template", GETHandler);
