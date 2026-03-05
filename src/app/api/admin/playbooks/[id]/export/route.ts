import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { actions, labels, playbookProductTypes, playbooks, productTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

const LIGHT_BLUE: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6EAF8" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const EVIDENCE_TYPES = ["photo", "reading", "observation", "action", "confirmation"];
const LIKELIHOODS = ["high", "medium", "low"];

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  instruction: string,
  columns: { header: string; key: string; width: number }[],
  rows: Record<string, string>[],
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

  const dataRows = rows.length > 0 ? rows : [Object.fromEntries(columns.map((c) => [c.key, ""]))];
  dataRows.forEach((row, index) => {
    const excelRow = ws.getRow(3 + index);
    columns.forEach((column, colIndex) => {
      excelRow.getCell(colIndex + 1).value = row[column.key] ?? "";
    });
  });

  if (validations) {
    for (const [key, allowed] of Object.entries(validations)) {
      const columnIndex = columns.findIndex((column) => column.key === key);
      if (columnIndex < 0) continue;
      for (let row = 3; row <= Math.max(300, dataRows.length + 20); row += 1) {
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

  const pushSection = (section: string, rows: { id: string; name: string }[], emptyMessage: string) => {
    if (rows.length === 0) {
      ws.addRow({ section, id: "-", name: emptyMessage });
      return;
    }
    for (const row of rows) {
      ws.addRow({ section, id: row.id, name: row.name });
    }
  };

  pushSection(
    "Labels",
    labelRows.map((item) => ({ id: item.id, name: item.displayName ?? item.id })),
    "No labels found"
  );
  ws.addRow({});
  pushSection(
    "Product types",
    productTypeRows.map((item) => ({ id: item.id, name: item.name })),
    "No product types found"
  );
  ws.addRow({});
  pushSection(
    "Actions",
    actionRows.map((item) => ({ id: item.id, name: item.title })),
    "No actions found"
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function GETHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [playbook] = await db.select().from(playbooks).where(eq(playbooks.id, id));
  if (!playbook) {
    return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
  }

  const [mappingRows, labelRows, productTypeRows, actionRows] = await Promise.all([
    db
      .select({ productTypeId: playbookProductTypes.productTypeId })
      .from(playbookProductTypes)
      .where(eq(playbookProductTypes.playbookId, id)),
    db.select({ id: labels.id, displayName: labels.displayName }).from(labels),
    db.select({ id: productTypes.id, name: productTypes.name }).from(productTypes),
    db.select({ id: actions.id, title: actions.title }).from(actions),
  ]);

  const productTypeIds = mappingRows.map((row) => row.productTypeId);
  const productTypeNames = productTypeRows
    .filter((row) => productTypeIds.includes(row.id))
    .map((row) => row.name);

  const symptoms = (playbook.symptoms as { id?: string; description?: string }[] | null) ?? [];
  const evidenceChecklist = (
    playbook.evidenceChecklist as
      | { id?: string; description?: string; actionId?: string; type?: string; required?: boolean }[]
      | null
  ) ?? [];
  const candidateCauses = (
    playbook.candidateCauses as { id?: string; cause?: string; likelihood?: string; rulingEvidence?: unknown }[] | null
  ) ?? [];
  const escalationTriggers = (playbook.escalationTriggers as { trigger?: string; reason?: string }[] | null) ?? [];
  const steps = (
    playbook.steps as { title?: string; instruction?: string; check?: string }[]
  ) ?? [];

  const wb = new ExcelJS.Workbook();
  addSheet(
    wb,
    "Overview",
    'Re-import this file to update this playbook. Keep playbook_id populated. Optional: product_type_ids (UUIDs) or product_type_names (names from Reference tab). Leave both blank to apply to all.',
    [
      { header: "playbook_id", key: "playbook_id", width: 40 },
      { header: "title", key: "title", width: 40 },
      { header: "label_id", key: "label_id", width: 30 },
      { header: "product_type_ids", key: "product_type_ids", width: 52 },
      { header: "product_type_names", key: "product_type_names", width: 40 },
    ],
    [
      {
        playbook_id: playbook.id,
        title: playbook.title ?? "",
        label_id: playbook.labelId ?? "",
        product_type_ids: productTypeIds.join(", "),
        product_type_names: productTypeNames.join(", "),
      },
    ]
  );
  addSheet(
    wb,
    "Symptoms",
    "List user-visible symptoms that should trigger this playbook. Leave id blank to auto-generate.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 64 },
    ],
    symptoms.map((item) => ({
      id: item.id ?? "",
      description: item.description ?? "",
    }))
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
    evidenceChecklist.map((item) => ({
      id: item.id ?? "",
      description: item.description ?? "",
      action_id: item.actionId ?? "",
      type: item.type ?? "",
      required: item.required ? "yes" : "no",
    })),
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
    candidateCauses.map((item) => ({
      id: item.id ?? "",
      cause: item.cause ?? "",
      likelihood: item.likelihood ?? "",
      ruling_evidence: toStringArray(item.rulingEvidence).join(", "),
    })),
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
    escalationTriggers.map((item) => ({
      trigger: item.trigger ?? "",
      reason: item.reason ?? "",
    }))
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
    steps.map((item) => ({
      title: item.title ?? "",
      instruction: item.instruction ?? "",
      check: item.check ?? "",
    }))
  );
  addReferenceSheet(wb, labelRows, productTypeRows, actionRows);

  const safeTitle = (playbook.title || "playbook")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fileName = `${safeTitle || "playbook"}-${playbook.id}.xlsx`;
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

export const GET = withApiRouteErrorLogging("/api/admin/playbooks/[id]/export", GETHandler);
