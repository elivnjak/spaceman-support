import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { actions, labels, playbookProductTypes, playbooks, productTypes } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

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

async function POSTHandler(request: Request) {
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
    const playbookId = overviewRows[0]?.playbook_id ?? "";
    const productTypeIdsCsv = overviewRows[0]?.product_type_ids ?? "";
    const productTypeNamesCsv =
      overviewRows[0]?.product_type_names ?? overviewRows[0]?.product_types ?? "";
    if (!title) errors.push("Overview sheet: title is required.");
    if (!labelId) errors.push("Overview sheet: label_id is required.");
    if (playbookId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playbookId)) {
      errors.push("Overview sheet: playbook_id must be a valid UUID when provided.");
    }

    const selectedProductTypeIds = new Set<string>();
    const requestedProductTypeIds = productTypeIdsCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const id of requestedProductTypeIds) selectedProductTypeIds.add(id);

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

    if (playbookId) {
      const [existingPlaybook] = await db
        .select({ id: playbooks.id })
        .from(playbooks)
        .where(eq(playbooks.id, playbookId));
      if (!existingPlaybook) {
        errors.push(`Overview sheet: playbook_id "${playbookId}" was not found.`);
      }
    }

    const requestedProductTypeNames = productTypeNamesCsv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (selectedProductTypeIds.size > 0 || requestedProductTypeNames.length > 0) {
      const allProductTypes = await db
        .select({ id: productTypes.id, name: productTypes.name })
        .from(productTypes);

      const productTypeNameToId = new Map(
        allProductTypes.map((item) => [item.name.toLowerCase(), item.id])
      );
      const validProductTypeIds = new Set(allProductTypes.map((item) => item.id));

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
        ...(r.action_id ? { actionId: r.action_id } : {}),
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
    }));

    const referencedActionIds = Array.from(
      new Set(
        [
          ...evidenceItems.map((item) => item.actionId).filter(Boolean),
        ] as string[],
      ),
    );
    if (referencedActionIds.length > 0) {
      const existingActions = await db
        .select({ id: actions.id, expectedInput: actions.expectedInput })
        .from(actions)
        .where(inArray(actions.id, referencedActionIds));
      const existingIds = new Set(existingActions.map((a) => a.id));
      const missingActionIds = referencedActionIds.filter((id) => !existingIds.has(id));
      if (missingActionIds.length > 0) {
        errors.push(
          `Unknown action_id values: ${missingActionIds.join(", ")}. Check Admin -> Actions for valid IDs.`,
        );
      }

      const expectedInputByActionId = new Map(
        existingActions.map((a) => [
          a.id,
          (a.expectedInput as { type?: string } | null)?.type?.toLowerCase(),
        ])
      );
      for (let i = 0; i < evidenceItems.length; i += 1) {
        const item = evidenceItems[i];
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
      return NextResponse.json({ error: errors.join("\n") }, { status: 400 });
    }

    const saved = await db.transaction(async (tx) => {
      const productTypeIds = Array.from(selectedProductTypeIds);
      const values = {
        labelId,
        title,
        steps,
        updatedAt: new Date(),
        ...(symptomItems.length > 0 ? { symptoms: symptomItems } : { symptoms: null }),
        ...(evidenceItems.length > 0 ? { evidenceChecklist: evidenceItems } : { evidenceChecklist: null }),
        ...(causeItems.length > 0 ? { candidateCauses: causeItems } : { candidateCauses: null }),
        ...(triggerItems.length > 0 ? { escalationTriggers: triggerItems } : { escalationTriggers: null }),
      };

      if (playbookId) {
        const [updatedPlaybook] = await tx
          .update(playbooks)
          .set(values)
          .where(eq(playbooks.id, playbookId))
          .returning();
        if (!updatedPlaybook) return null;
        await tx.delete(playbookProductTypes).where(eq(playbookProductTypes.playbookId, playbookId));
        if (productTypeIds.length > 0) {
          await tx.insert(playbookProductTypes).values(
            productTypeIds.map((productTypeId) => ({
              playbookId,
              productTypeId,
            }))
          );
        }
        return {
          ...updatedPlaybook,
          productTypeIds,
        };
      }

      const [createdPlaybook] = await tx
        .insert(playbooks)
        .values({
          labelId,
          title,
          steps,
          ...(symptomItems.length > 0 && { symptoms: symptomItems }),
          ...(evidenceItems.length > 0 && { evidenceChecklist: evidenceItems }),
          ...(causeItems.length > 0 && { candidateCauses: causeItems }),
          ...(triggerItems.length > 0 && { escalationTriggers: triggerItems }),
        })
        .returning();

      if (productTypeIds.length > 0) {
        await tx.insert(playbookProductTypes).values(
          productTypeIds.map((productTypeId) => ({
            playbookId: createdPlaybook.id,
            productTypeId,
          }))
        );
      }

      return {
        ...createdPlaybook,
        productTypeIds,
      };
    });
    if (!saved) {
      return NextResponse.json({ error: "Playbook not found" }, { status: 404 });
    }

    return NextResponse.json(saved);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiRouteErrorLogging("/api/admin/playbooks/import", POSTHandler);
