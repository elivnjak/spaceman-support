import "dotenv/config";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { actions, playbooks } from "@/lib/db/schema";
import {
  CauseItemSchema,
  EvidenceItemSchema,
  type CauseItem,
  type EvidenceItem,
  type EvidenceValueDefinition,
} from "@/lib/playbooks/schema";

type ExpectedInput = {
  type?: string;
  options?: string[];
  unit?: string;
  range?: {
    min?: number;
    max?: number;
  };
};

type ActionRow = Pick<typeof actions.$inferSelect, "id" | "expectedInput">;
type PlaybookRow = Pick<
  typeof playbooks.$inferSelect,
  "id" | "title" | "schemaVersion" | "evidenceChecklist" | "candidateCauses"
>;

function parseArgs(argv: string[]) {
  const ids: string[] = [];
  let allV1 = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all-v1") {
      allV1 = true;
      continue;
    }
    if (arg === "--playbook-id") {
      const value = argv[index + 1];
      if (!value) throw new Error("--playbook-id requires a value");
      ids.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!allV1 && ids.length === 0) {
    throw new Error("Provide --all-v1 or at least one --playbook-id");
  }

  return { allV1, ids };
}

function parseExpectedInput(value: unknown): ExpectedInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (!type) return null;

  const options = Array.isArray(record.options)
    ? record.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  const range =
    record.range && typeof record.range === "object"
      ? (record.range as Record<string, unknown>)
      : undefined;

  return {
    type,
    ...(options?.length ? { options } : {}),
    ...(typeof record.unit === "string" ? { unit: record.unit } : {}),
    ...(range
      ? {
          range: {
            ...(typeof range.min === "number" ? { min: range.min } : {}),
            ...(typeof range.max === "number" ? { max: range.max } : {}),
          },
        }
      : {}),
  };
}

function deriveUnknownValues(input: ExpectedInput): string[] | undefined {
  const options = input.options ?? [];
  const unknownValues = options.filter((option) => {
    const normalized = option.trim().toLowerCase();
    return (
      normalized === "unknown" ||
      normalized === "not sure" ||
      normalized === "unsure" ||
      normalized === "unable to confirm" ||
      normalized === "unable to perform safely" ||
      normalized === "unable to complete safely" ||
      normalized === "skipped"
    );
  });
  return unknownValues.length > 0 ? unknownValues : undefined;
}

function deriveValueDefinition(
  item: EvidenceItem,
  actionById: Map<string, ActionRow>
): EvidenceValueDefinition | undefined {
  if (item.valueDefinition) return item.valueDefinition;

  if (item.type === "photo") {
    return { kind: "photo" };
  }

  const expectedInput = item.actionId ? parseExpectedInput(actionById.get(item.actionId)?.expectedInput) : null;
  if (!expectedInput) {
    if (item.type === "confirmation") return { kind: "boolean" };
    if (item.type === "reading") return { kind: "number" };
    return undefined;
  }

  const normalizedType = expectedInput.type?.toLowerCase() ?? "";
  if (normalizedType === "photo") return { kind: "photo" };
  if (normalizedType === "boolean") return { kind: "boolean" };
  if (normalizedType === "number") {
    return {
      kind: "number",
      ...(expectedInput.unit ? { unit: expectedInput.unit } : {}),
      ...(expectedInput.range?.min !== undefined || expectedInput.range?.max !== undefined
        ? {
            notes: [
              expectedInput.range?.min !== undefined ? `min=${expectedInput.range.min}` : null,
              expectedInput.range?.max !== undefined ? `max=${expectedInput.range.max}` : null,
            ]
              .filter(Boolean)
              .join(", "),
          }
        : {}),
    };
  }
  if (expectedInput.options?.length) {
    return {
      kind: normalizedType === "boolean" ? "boolean" : "enum",
      options: expectedInput.options,
      ...(deriveUnknownValues(expectedInput) ? { unknownValues: deriveUnknownValues(expectedInput) } : {}),
    };
  }

  return { kind: "text" };
}

function migrateEvidenceChecklist(
  playbook: PlaybookRow,
  actionById: Map<string, ActionRow>
): EvidenceItem[] {
  const checklist = Array.isArray(playbook.evidenceChecklist) ? playbook.evidenceChecklist : [];
  return checklist
    .map((item) => EvidenceItemSchema.safeParse(item))
    .map((result) => (result.success ? result.data : null))
    .filter((item): item is EvidenceItem => Boolean(item))
    .map((item) => ({
      ...item,
      ...(deriveValueDefinition(item, actionById) ? { valueDefinition: deriveValueDefinition(item, actionById) } : {}),
    }));
}

function migrateCandidateCauses(playbook: PlaybookRow): CauseItem[] {
  const causes = Array.isArray(playbook.candidateCauses) ? playbook.candidateCauses : [];
  return causes
    .map((item) => CauseItemSchema.safeParse(item))
    .map((result) => (result.success ? result.data : null))
    .filter((item): item is CauseItem => Boolean(item))
    .map((cause) => ({
      ...cause,
      ...(cause.supportMode ? {} : { supportMode: "all" as const }),
    }));
}

async function loadTargetPlaybooks(targetIds: string[], allV1: boolean): Promise<PlaybookRow[]> {
  if (allV1) {
    const rows = await db
      .select({
        id: playbooks.id,
        title: playbooks.title,
        schemaVersion: playbooks.schemaVersion,
        evidenceChecklist: playbooks.evidenceChecklist,
        candidateCauses: playbooks.candidateCauses,
      })
      .from(playbooks);
    return rows.filter((row) => row.schemaVersion === 1);
  }

  const rows = await db
    .select({
      id: playbooks.id,
      title: playbooks.title,
      schemaVersion: playbooks.schemaVersion,
      evidenceChecklist: playbooks.evidenceChecklist,
      candidateCauses: playbooks.candidateCauses,
    })
    .from(playbooks)
    .where(inArray(playbooks.id, targetIds));

  return rows;
}

async function main() {
  const { allV1, ids } = parseArgs(process.argv.slice(2));
  const targetPlaybooks = await loadTargetPlaybooks(ids, allV1);
  if (targetPlaybooks.length === 0) {
    console.log("No matching playbooks found.");
    return;
  }

  const actionRows = await db.select({ id: actions.id, expectedInput: actions.expectedInput }).from(actions);
  const actionById = new Map(actionRows.map((row) => [row.id, row] as const));

  for (const playbook of targetPlaybooks) {
    const evidenceChecklist = migrateEvidenceChecklist(playbook, actionById);
    const candidateCauses = migrateCandidateCauses(playbook);

    await db
      .update(playbooks)
      .set({
        schemaVersion: 2,
        evidenceChecklist,
        candidateCauses,
        updatedAt: new Date(),
      })
      .where(eq(playbooks.id, playbook.id));

    console.log(
      `migrated ${playbook.id} (${playbook.title}) to schema v2 baseline with ${evidenceChecklist.length} evidence items`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
