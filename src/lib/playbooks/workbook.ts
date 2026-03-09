import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { db, type Action, type Label, type Playbook, type ProductType } from "@/lib/db";
import { actions, labels, playbookProductTypes, playbooks, productTypes } from "@/lib/db/schema";
import {
  CauseItemSchema,
  EVIDENCE_TYPES,
  EvidenceItemSchema,
  LIKELIHOODS,
  type CauseItem,
  type EvidenceItem,
  type StepItem,
  type SymptomItem,
  type TriggerItem,
  parseRulesJsonCell,
  parseStringArrayCell,
  playbookUsesStructuredSemantics,
  serializeRulesForWorkbook,
  serializeStringArrayForWorkbook,
} from "./schema";

type DatabaseLike = typeof db;

type WorkbookSheetColumn = {
  header: string;
  key: string;
  width: number;
};

type RowRecord = Record<string, string>;

const LIGHT_BLUE: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6EAF8" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11 };

export type PlaybookWorkbookPayload = {
  playbookId?: string;
  title: string;
  labelId: string;
  productTypeIds: string[];
  productTypeNames: string[];
  schemaVersion?: number;
  symptoms: SymptomItem[];
  evidenceChecklist: EvidenceItem[];
  candidateCauses: CauseItem[];
  escalationTriggers: TriggerItem[];
  steps: StepItem[];
};

export type PlaybookWorkbookReferenceData = {
  labels: Pick<Label, "id" | "displayName">[];
  productTypes: Pick<ProductType, "id" | "name">[];
  actions: Pick<Action, "id" | "title" | "expectedInput">[];
};

export type PlaybookWorkbookParseResult =
  | {
      ok: true;
      payload: PlaybookWorkbookPayload;
    }
  | {
      ok: false;
      errors: string[];
    };

export type SavedPlaybookResult = Playbook & {
  productTypeIds: string[];
};

function str(cell: ExcelJS.CellValue): string {
  if (cell == null) return "";
  if (typeof cell === "object" && "text" in cell) return String(cell.text);
  return String(cell).trim();
}

function readRows(ws: ExcelJS.Worksheet | undefined, startRow = 3): RowRecord[] {
  if (!ws) return [];
  const rows: RowRecord[] = [];
  const headerRow = ws.getRow(2);
  const keys: string[] = [];
  headerRow.eachCell((cell, col) => {
    keys[col] = str(cell.value).toLowerCase().replace(/\s+/g, "_");
  });

  ws.eachRow((row, rowNum) => {
    if (rowNum < startRow) return;
    const record: RowRecord = {};
    let hasValue = false;
    row.eachCell((cell, col) => {
      const key = keys[col];
      if (!key) return;
      record[key] = str(cell.value);
      if (record[key]) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  instruction: string,
  columns: WorkbookSheetColumn[],
  rows: RowRecord[],
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

  const dataRows =
    rows.length > 0 ? rows : [Object.fromEntries(columns.map((column) => [column.key, ""]))];
  dataRows.forEach((row, index) => {
    const excelRow = ws.getRow(3 + index);
    columns.forEach((column, colIndex) => {
      excelRow.getCell(colIndex + 1).value = row[column.key] ?? "";
    });
  });

  if (!validations) return;
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

function addReferenceSheet(
  wb: ExcelJS.Workbook,
  referenceData: PlaybookWorkbookReferenceData
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
    rows.forEach((row) => ws.addRow({ section, id: row.id, name: row.name }));
  };

  pushSection(
    "Labels",
    referenceData.labels.map((item) => ({ id: item.id, name: item.displayName ?? item.id })),
    "No labels found"
  );
  ws.addRow({});
  pushSection(
    "Product types",
    referenceData.productTypes.map((item) => ({ id: item.id, name: item.name })),
    "No product types found"
  );
  ws.addRow({});
  pushSection(
    "Actions",
    referenceData.actions.map((item) => ({ id: item.id, name: item.title })),
    "No actions found"
  );
}

export async function getPlaybookWorkbookReferenceData(database: DatabaseLike = db) {
  const [labelRows, productTypeRows, actionRows] = await Promise.all([
    database.select({ id: labels.id, displayName: labels.displayName }).from(labels),
    database.select({ id: productTypes.id, name: productTypes.name }).from(productTypes),
    database
      .select({ id: actions.id, title: actions.title, expectedInput: actions.expectedInput })
      .from(actions),
  ]);

  return {
    labels: labelRows,
    productTypes: productTypeRows,
    actions: actionRows,
  };
}

export async function buildPlaybookWorkbookBuffer(
  playbookId: string,
  database: DatabaseLike = db
): Promise<{ buffer: Buffer; fileName: string }> {
  const [playbook] = await database
    .select()
    .from(playbooks)
    .where(eq(playbooks.id, playbookId));
  if (!playbook) {
    throw new Error("Playbook not found");
  }

  const [mappingRows, referenceData] = await Promise.all([
    database
      .select({ productTypeId: playbookProductTypes.productTypeId })
      .from(playbookProductTypes)
      .where(eq(playbookProductTypes.playbookId, playbookId)),
    getPlaybookWorkbookReferenceData(database),
  ]);

  const productTypeIds = mappingRows.map((row) => row.productTypeId);
  const productTypeNames = referenceData.productTypes
    .filter((row) => productTypeIds.includes(row.id))
    .map((row) => row.name);

  const symptoms = (playbook.symptoms as SymptomItem[] | null) ?? [];
  const evidenceChecklist = (playbook.evidenceChecklist as EvidenceItem[] | null) ?? [];
  const candidateCauses = (playbook.candidateCauses as CauseItem[] | null) ?? [];
  const escalationTriggers = (playbook.escalationTriggers as TriggerItem[] | null) ?? [];
  const steps = (playbook.steps as StepItem[] | null) ?? [];

  const wb = new ExcelJS.Workbook();
  addSheet(
    wb,
    "Overview",
    'Re-import this file to update this playbook. Keep playbook_id populated. Optional: product_type_ids (UUIDs) or product_type_names (names from Reference tab). Leave both blank to apply to all.',
    [
      { header: "playbook_id", key: "playbook_id", width: 40 },
      { header: "title", key: "title", width: 40 },
      { header: "label_id", key: "label_id", width: 30 },
      { header: "schema_version", key: "schema_version", width: 16 },
      { header: "product_type_ids", key: "product_type_ids", width: 52 },
      { header: "product_type_names", key: "product_type_names", width: 40 },
    ],
    [
      {
        playbook_id: playbook.id,
        title: playbook.title ?? "",
        label_id: playbook.labelId ?? "",
        schema_version: String(playbook.schemaVersion ?? 1),
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
    'Evidence to gather. "action_id" is optional and must exist in Admin -> Actions. Required is yes/no. Optional v2 fields: value_kind, value_options, value_unit, unknown_values.',
    [
      { header: "id", key: "id", width: 25 },
      { header: "description", key: "description", width: 50 },
      { header: "action_id", key: "action_id", width: 30 },
      { header: "type", key: "type", width: 18 },
      { header: "required", key: "required", width: 12 },
      { header: "value_kind", key: "value_kind", width: 18 },
      { header: "value_options", key: "value_options", width: 34 },
      { header: "value_unit", key: "value_unit", width: 16 },
      { header: "unknown_values", key: "unknown_values", width: 28 },
    ],
    evidenceChecklist.map((item) => ({
      id: item.id ?? "",
      description: item.description ?? "",
      action_id: item.actionId ?? "",
      type: item.type ?? "",
      required: item.required ? "yes" : "no",
      value_kind: item.valueDefinition?.kind ?? "",
      value_options: serializeStringArrayForWorkbook(item.valueDefinition?.options),
      value_unit: item.valueDefinition?.unit ?? "",
      unknown_values: serializeStringArrayForWorkbook(item.valueDefinition?.unknownValues),
    })),
    {
      type: [...EVIDENCE_TYPES],
      required: ["yes", "no"],
      value_kind: ["photo", "boolean", "enum", "number", "text"],
    }
  );
  addSheet(
    wb,
    "Causes",
    "Possible root causes. ruling_evidence is a comma-separated list of Evidence IDs. Optional v2 fields: outcome, support_mode, support_rules_json, exclude_rules_json.",
    [
      { header: "id", key: "id", width: 25 },
      { header: "cause", key: "cause", width: 54 },
      { header: "likelihood", key: "likelihood", width: 14 },
      { header: "ruling_evidence", key: "ruling_evidence", width: 40 },
      { header: "outcome", key: "outcome", width: 16 },
      { header: "support_mode", key: "support_mode", width: 16 },
      { header: "support_rules_json", key: "support_rules_json", width: 52 },
      { header: "exclude_rules_json", key: "exclude_rules_json", width: 52 },
    ],
    candidateCauses.map((item) => ({
      id: item.id ?? "",
      cause: item.cause ?? "",
      likelihood: item.likelihood ?? "",
      ruling_evidence: toStringArray(item.rulingEvidence).join(", "),
      outcome: item.outcome ?? "",
      support_mode: item.supportMode ?? "",
      support_rules_json: serializeRulesForWorkbook(item.supportRules),
      exclude_rules_json: serializeRulesForWorkbook(item.excludeRules),
    })),
    { likelihood: [...LIKELIHOODS], outcome: ["resolution", "escalation"], support_mode: ["all", "any"] }
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
  addReferenceSheet(wb, referenceData);

  const safeTitle = (playbook.title || "playbook")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fileName = `${safeTitle || "playbook"}-${playbook.id}.xlsx`;
  const workbookBytes = await wb.xlsx.writeBuffer();
  const normalizedWorkbookBytes =
    workbookBytes instanceof ArrayBuffer
      ? new Uint8Array(workbookBytes)
      : Uint8Array.from(workbookBytes);
  const buffer = Buffer.from(normalizedWorkbookBytes);

  return { buffer, fileName };
}

export async function parsePlaybookWorkbookBuffer(
  input: Buffer | ArrayBuffer,
  database: DatabaseLike = db
): Promise<PlaybookWorkbookParseResult> {
  const wb = new ExcelJS.Workbook();
  const normalizedInput =
    input instanceof ArrayBuffer ? Buffer.from(new Uint8Array(input)) : Buffer.from(input);
  await wb.xlsx.load(normalizedInput as any);
  const errors: string[] = [];

  const overviewWs = wb.getWorksheet("Overview");
  if (!overviewWs) {
    return {
      ok: false,
      errors: ['Missing "Overview" sheet. Please use the playbook template.'],
    };
  }

  const overviewRows = readRows(overviewWs);
  if (overviewRows.length === 0) {
    errors.push("Overview sheet: fill in at least one row with title and label_id.");
  }

  const title = overviewRows[0]?.title ?? "";
  const labelId = overviewRows[0]?.label_id ?? "";
  const playbookId = overviewRows[0]?.playbook_id ?? "";
  const schemaVersionRaw = overviewRows[0]?.schema_version ?? "";
  const productTypeIdsCsv = overviewRows[0]?.product_type_ids ?? "";
  const productTypeNamesCsv =
    overviewRows[0]?.product_type_names ?? overviewRows[0]?.product_types ?? "";

  if (!title) errors.push("Overview sheet: title is required.");
  if (!labelId) errors.push("Overview sheet: label_id is required.");
  if (
    playbookId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      playbookId
    )
  ) {
    errors.push("Overview sheet: playbook_id must be a valid UUID when provided.");
  }
  const parsedSchemaVersion = schemaVersionRaw ? Number(schemaVersionRaw) : null;
  if (
    schemaVersionRaw &&
    (parsedSchemaVersion == null ||
      !Number.isInteger(parsedSchemaVersion) ||
      parsedSchemaVersion < 1)
  ) {
    errors.push("Overview sheet: schema_version must be a whole number greater than or equal to 1.");
  }

  const selectedProductTypeIds = new Set(
    productTypeIdsCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const requestedProductTypeNames = productTypeNamesCsv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const referenceData = await getPlaybookWorkbookReferenceData(database);
  const productTypeNameToId = new Map(
    referenceData.productTypes.map((item) => [item.name.toLowerCase(), item.id])
  );
  const validProductTypeIds = new Set(referenceData.productTypes.map((item) => item.id));

  const unknownIds = Array.from(selectedProductTypeIds).filter((id) => !validProductTypeIds.has(id));
  if (unknownIds.length > 0) {
    errors.push(
      `Overview sheet: unknown product_type_ids: ${unknownIds.join(", ")}. Check Admin -> Product Types for valid IDs.`
    );
  }

  const unknownNames: string[] = [];
  for (const rawName of requestedProductTypeNames) {
    const normalized = rawName.toLowerCase();
    if (normalized === "all" || normalized === "all product types") continue;
    const mappedId = productTypeNameToId.get(normalized);
    if (!mappedId) {
      unknownNames.push(rawName);
      continue;
    }
    selectedProductTypeIds.add(mappedId);
  }
  if (unknownNames.length > 0) {
    errors.push(
      `Overview sheet: unknown product_type_names: ${unknownNames.join(", ")}. Use exact names from Admin -> Product Types.`
    );
  }

  if (playbookId) {
    const [existingPlaybook] = await database
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(eq(playbooks.id, playbookId));
    if (!existingPlaybook) {
      errors.push(`Overview sheet: playbook_id "${playbookId}" was not found.`);
    }
  }

  const symptoms = readRows(wb.getWorksheet("Symptoms")).map((row, index) => ({
    id: row.id || `symptom_${index + 1}`,
    description: row.description ?? "",
  }));

  const evidenceChecklist = readRows(wb.getWorksheet("Evidence")).map((row, index) => {
    const type = (row.type ?? "").toLowerCase();
    if (type && !new Set(EVIDENCE_TYPES).has(type as EvidenceItem["type"])) {
      errors.push(
        `Evidence sheet row ${index + 3}: invalid type "${row.type}". Must be one of: ${[
          ...EVIDENCE_TYPES,
        ].join(", ")}.`
      );
    }
    const valueDefinition =
      row.value_kind || row.value_options || row.value_unit || row.unknown_values
        ? {
            ...(row.value_kind ? { kind: row.value_kind as NonNullable<EvidenceItem["valueDefinition"]>["kind"] } : {}),
            ...(row.value_options ? { options: parseStringArrayCell(row.value_options) } : {}),
            ...(row.value_unit ? { unit: row.value_unit } : {}),
            ...(row.unknown_values ? { unknownValues: parseStringArrayCell(row.unknown_values) } : {}),
          }
        : undefined;
    const candidate = {
      id: row.id || `evidence_${index + 1}`,
      description: row.description ?? "",
      ...(row.action_id ? { actionId: row.action_id } : {}),
      type: (type || "observation") as EvidenceItem["type"],
      required: ["yes", "true", "1"].includes((row.required ?? "").toLowerCase()),
      ...(valueDefinition ? { valueDefinition } : {}),
    };
    const parsed = EvidenceItemSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push(
        `Evidence sheet row ${index + 3}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
      );
    }
    return candidate;
  });

  const candidateCauses = readRows(wb.getWorksheet("Causes")).map((row, index) => {
    const likelihood = (row.likelihood ?? "").toLowerCase();
    if (likelihood && !new Set(LIKELIHOODS).has(likelihood as CauseItem["likelihood"])) {
      errors.push(
        `Causes sheet row ${index + 3}: invalid likelihood "${row.likelihood}". Must be one of: high, medium, low.`
      );
    }
    let supportRules: CauseItem["supportRules"] | undefined;
    let excludeRules: CauseItem["excludeRules"] | undefined;
    try {
      supportRules = row.support_rules_json
        ? parseRulesJsonCell(row.support_rules_json)
        : undefined;
    } catch (error) {
      errors.push(
        `Causes sheet row ${index + 3}: invalid support_rules_json. ${error instanceof Error ? error.message : "Expected JSON array of rules."}`
      );
    }
    try {
      excludeRules = row.exclude_rules_json
        ? parseRulesJsonCell(row.exclude_rules_json)
        : undefined;
    } catch (error) {
      errors.push(
        `Causes sheet row ${index + 3}: invalid exclude_rules_json. ${error instanceof Error ? error.message : "Expected JSON array of rules."}`
      );
    }
    const candidate = {
      id: row.id || `cause_${index + 1}`,
      cause: row.cause ?? "",
      likelihood: (likelihood || "medium") as CauseItem["likelihood"],
      rulingEvidence: (row.ruling_evidence ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      ...(row.outcome ? { outcome: row.outcome as CauseItem["outcome"] } : {}),
      ...(row.support_mode ? { supportMode: row.support_mode as CauseItem["supportMode"] } : {}),
      ...(supportRules ? { supportRules } : {}),
      ...(excludeRules ? { excludeRules } : {}),
    };
    const parsed = CauseItemSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push(
        `Causes sheet row ${index + 3}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
      );
    }
    return candidate;
  });

  const escalationTriggers = readRows(wb.getWorksheet("Triggers")).map((row) => ({
    trigger: row.trigger ?? "",
    reason: row.reason ?? "",
  }));

  const stepRows = readRows(wb.getWorksheet("Steps"));
  if (stepRows.length === 0) {
    errors.push("Steps sheet: at least one step is required.");
  }
  const steps = stepRows.map((row) => ({
    step_id: randomUUID(),
    title: row.title ?? "",
    instruction: row.instruction ?? "",
    ...(row.check ? { check: row.check } : {}),
  }));

  const referencedActionIds = Array.from(
    new Set(evidenceChecklist.map((item) => item.actionId).filter(Boolean) as string[])
  );
  if (referencedActionIds.length > 0) {
    const existingActions = await database
      .select({ id: actions.id, expectedInput: actions.expectedInput })
      .from(actions)
      .where(inArray(actions.id, referencedActionIds));
    const existingIds = new Set(existingActions.map((item) => item.id));
    const missingActionIds = referencedActionIds.filter((id) => !existingIds.has(id));
    if (missingActionIds.length > 0) {
      errors.push(
        `Unknown action_id values: ${missingActionIds.join(", ")}. Check Admin -> Actions for valid IDs.`
      );
    }

    const expectedInputByActionId = new Map(
      existingActions.map((item) => [
        item.id,
        (item.expectedInput as { type?: string } | null)?.type?.toLowerCase(),
      ])
    );

    for (let index = 0; index < evidenceChecklist.length; index += 1) {
      const item = evidenceChecklist[index];
      if (!item.actionId) continue;
      const expectedType = expectedInputByActionId.get(item.actionId);
      if (!expectedType) continue;
      if (expectedType === "photo") item.type = "photo";
      else if (expectedType === "number") item.type = "reading";
      else if (expectedType === "boolean" || expectedType === "bool") item.type = "confirmation";
      else if (item.type !== "action") item.type = "observation";
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      ...(playbookId ? { playbookId } : {}),
      title,
      labelId,
      productTypeIds: Array.from(selectedProductTypeIds),
      productTypeNames: requestedProductTypeNames,
      schemaVersion:
        parsedSchemaVersion ??
        (playbookUsesStructuredSemantics({ evidenceChecklist, candidateCauses })
          ? 2
          : 1),
      symptoms,
      evidenceChecklist,
      candidateCauses,
      escalationTriggers,
      steps,
    },
  };
}

export async function savePlaybookWorkbookPayload(
  payload: PlaybookWorkbookPayload,
  database: DatabaseLike = db
): Promise<SavedPlaybookResult> {
  const [existingLabel] = await database
    .select()
    .from(labels)
    .where(eq(labels.id, payload.labelId));
  if (!existingLabel) {
    const displayName = payload.labelId
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
    await database.insert(labels).values({
      id: payload.labelId,
      displayName,
    });
  }

  const values = {
    labelId: payload.labelId,
    title: payload.title,
    steps: payload.steps,
    schemaVersion:
      payload.schemaVersion ??
      (playbookUsesStructuredSemantics(payload) ? 2 : 1),
    updatedAt: new Date(),
    ...(payload.symptoms.length > 0 ? { symptoms: payload.symptoms } : { symptoms: null }),
    ...(payload.evidenceChecklist.length > 0
      ? { evidenceChecklist: payload.evidenceChecklist }
      : { evidenceChecklist: null }),
    ...(payload.candidateCauses.length > 0
      ? { candidateCauses: payload.candidateCauses }
      : { candidateCauses: null }),
    ...(payload.escalationTriggers.length > 0
      ? { escalationTriggers: payload.escalationTriggers }
      : { escalationTriggers: null }),
  };

  const saved = await database.transaction(async (tx) => {
    if (payload.playbookId) {
      const [updatedPlaybook] = await tx
        .update(playbooks)
        .set(values)
        .where(eq(playbooks.id, payload.playbookId))
        .returning();
      if (!updatedPlaybook) {
        throw new Error("Playbook not found");
      }

      await tx
        .delete(playbookProductTypes)
        .where(eq(playbookProductTypes.playbookId, payload.playbookId));

      if (payload.productTypeIds.length > 0) {
        await tx.insert(playbookProductTypes).values(
          payload.productTypeIds.map((productTypeId) => ({
            playbookId: payload.playbookId!,
            productTypeId,
          }))
        );
      }

      return {
        ...updatedPlaybook,
        productTypeIds: payload.productTypeIds,
      };
    }

    const [createdPlaybook] = await tx
      .insert(playbooks)
      .values({
        labelId: payload.labelId,
        title: payload.title,
        steps: payload.steps,
        ...(payload.symptoms.length > 0 && { symptoms: payload.symptoms }),
        ...(payload.evidenceChecklist.length > 0 && {
          evidenceChecklist: payload.evidenceChecklist,
        }),
        ...(payload.candidateCauses.length > 0 && {
          candidateCauses: payload.candidateCauses,
        }),
        ...(payload.escalationTriggers.length > 0 && {
          escalationTriggers: payload.escalationTriggers,
        }),
      })
      .returning();

    if (payload.productTypeIds.length > 0) {
      await tx.insert(playbookProductTypes).values(
        payload.productTypeIds.map((productTypeId) => ({
          playbookId: createdPlaybook.id,
          productTypeId,
        }))
      );
    }

    return {
      ...createdPlaybook,
      productTypeIds: payload.productTypeIds,
    };
  });

  return saved;
}

export async function importPlaybookWorkbookBuffer(
  input: Buffer | ArrayBuffer,
  database: DatabaseLike = db
): Promise<PlaybookWorkbookParseResult & { saved?: SavedPlaybookResult }> {
  const parsed = await parsePlaybookWorkbookBuffer(input, database);
  if (!parsed.ok) return parsed;
  const saved = await savePlaybookWorkbookPayload(parsed.payload, database);
  return {
    ok: true,
    payload: parsed.payload,
    saved,
  };
}
