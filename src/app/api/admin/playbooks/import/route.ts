import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { labels, playbooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const EVIDENCE_TYPES = new Set([
  "photo",
  "reading",
  "observation",
  "action",
  "confirmation",
]);
const LIKELIHOODS = new Set(["high", "medium", "low"]);

function str(cell: ExcelJS.CellValue): string {
  if (cell == null) return "";
  if (typeof cell === "object" && "text" in cell) return String(cell.text);
  return String(cell).trim();
}

function readRows(ws: ExcelJS.Worksheet | undefined, startRow = 3) {
  if (!ws) return [];
  const rows: Record<string, string>[] = [];
  const headerRow = ws.getRow(2);
  const keys: string[] = [];
  headerRow.eachCell((cell, col) => {
    keys[col] = str(cell.value).toLowerCase().replace(/\s+/g, "_");
  });

  ws.eachRow((row, rowNum) => {
    if (rowNum < startRow) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    row.eachCell((cell, col) => {
      const key = keys[col];
      if (key) {
        record[key] = str(cell.value);
        if (record[key]) hasValue = true;
      }
    });
    if (hasValue) rows.push(record);
  });
  return rows;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file uploaded. Attach an .xlsx file as the 'file' field." },
        { status: 400 },
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuf);

    const errors: string[] = [];

    // --- Overview ---
    const overviewWs = wb.getWorksheet("Overview");
    if (!overviewWs) {
      return NextResponse.json(
        { error: 'Missing "Overview" sheet. Please use the playbook template.' },
        { status: 400 },
      );
    }
    const overviewRows = readRows(overviewWs);
    if (overviewRows.length === 0) {
      errors.push("Overview sheet: fill in at least one row with title and label_id.");
    }
    const title = overviewRows[0]?.title ?? "";
    const labelId = overviewRows[0]?.label_id ?? "";
    if (!title) errors.push("Overview sheet: title is required.");
    if (!labelId) errors.push("Overview sheet: label_id is required.");

    if (labelId) {
      const [label] = await db
        .select()
        .from(labels)
        .where(eq(labels.id, labelId));
      if (!label) {
        errors.push(
          `Overview sheet: label_id "${labelId}" does not exist. Check Admin → Labels for valid IDs.`,
        );
      }
    }

    // --- Symptoms ---
    const symptomRows = readRows(wb.getWorksheet("Symptoms"));
    const symptomItems = symptomRows.map((r, i) => ({
      id: r.id || `symptom_${i + 1}`,
      description: r.description ?? "",
    }));

    // --- Evidence ---
    const evidenceRows = readRows(wb.getWorksheet("Evidence"));
    const evidenceItems = evidenceRows.map((r, i) => {
      const type = (r.type ?? "").toLowerCase();
      if (type && !EVIDENCE_TYPES.has(type)) {
        errors.push(
          `Evidence sheet row ${i + 3}: invalid type "${r.type}". Must be one of: ${[...EVIDENCE_TYPES].join(", ")}.`,
        );
      }
      return {
        id: r.id || `evidence_${i + 1}`,
        description: r.description ?? "",
        type: (type || "observation") as
          | "photo"
          | "reading"
          | "observation"
          | "action"
          | "confirmation",
        required: ["yes", "true", "1"].includes((r.required ?? "").toLowerCase()),
      };
    });

    // --- Causes ---
    const causeRows = readRows(wb.getWorksheet("Causes"));
    const causeItems = causeRows.map((r, i) => {
      const likelihood = (r.likelihood ?? "").toLowerCase();
      if (likelihood && !LIKELIHOODS.has(likelihood)) {
        errors.push(
          `Causes sheet row ${i + 3}: invalid likelihood "${r.likelihood}". Must be one of: high, medium, low.`,
        );
      }
      const rulingEvidence = (r.ruling_evidence ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        id: r.id || `cause_${i + 1}`,
        cause: r.cause ?? "",
        likelihood: (likelihood || "medium") as "high" | "medium" | "low",
        rulingEvidence,
      };
    });

    // --- Questions ---
    const questionRows = readRows(wb.getWorksheet("Questions"));
    const questionItems = questionRows.map((r, i) => ({
      id: r.id || `question_${i + 1}`,
      question: r.question ?? "",
      purpose: r.purpose ?? "",
      ...(r.when_to_ask ? { whenToAsk: r.when_to_ask } : {}),
    }));

    // --- Triggers ---
    const triggerRows = readRows(wb.getWorksheet("Triggers"));
    const triggerItems = triggerRows.map((r) => ({
      trigger: r.trigger ?? "",
      reason: r.reason ?? "",
    }));

    // --- Steps ---
    const stepRows = readRows(wb.getWorksheet("Steps"));
    if (stepRows.length === 0) {
      errors.push("Steps sheet: at least one step is required.");
    }
    const steps = stepRows.map((r) => ({
      step_id: randomUUID(),
      title: r.title ?? "",
      instruction: r.instruction ?? "",
      ...(r.check ? { check: r.check } : {}),
      ...(r.if_failed ? { if_failed: r.if_failed } : {}),
    }));

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("\n") }, { status: 400 });
    }

    const [created] = await db
      .insert(playbooks)
      .values({
        labelId,
        title,
        steps,
        ...(symptomItems.length > 0 && { symptoms: symptomItems }),
        ...(evidenceItems.length > 0 && { evidenceChecklist: evidenceItems }),
        ...(causeItems.length > 0 && { candidateCauses: causeItems }),
        ...(questionItems.length > 0 && { diagnosticQuestions: questionItems }),
        ...(triggerItems.length > 0 && { escalationTriggers: triggerItems }),
      })
      .returning();

    return NextResponse.json(created);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
