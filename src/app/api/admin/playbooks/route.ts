import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { playbookProductTypes, playbooks } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";

type Step = {
  step_id: string;
  title: string;
  instruction: string;
  check?: string;
  if_failed?: string;
  safetyLevel?: "safe" | "caution" | "technician_only";
};

function ensureStepIds(steps: Step[]): Step[] {
  return steps.map((s) => ({
    ...s,
    step_id: s.step_id || randomUUID(),
    title: s.title ?? "",
    instruction: s.instruction ?? "",
    check: s.check,
    if_failed: s.if_failed,
  }));
}

export async function GET() {
  const list = await db.select().from(playbooks).orderBy(playbooks.updatedAt);
  if (list.length === 0) {
    return NextResponse.json([]);
  }

  const playbookIds = list.map((item) => item.id);
  const mappingRows = await db
    .select({
      playbookId: playbookProductTypes.playbookId,
      productTypeId: playbookProductTypes.productTypeId,
    })
    .from(playbookProductTypes)
    .where(inArray(playbookProductTypes.playbookId, playbookIds));

  const productTypeIdsByPlaybookId = new Map<string, string[]>();
  for (const row of mappingRows) {
    const existing = productTypeIdsByPlaybookId.get(row.playbookId);
    if (existing) {
      existing.push(row.productTypeId);
    } else {
      productTypeIdsByPlaybookId.set(row.playbookId, [row.productTypeId]);
    }
  }

  return NextResponse.json(
    list.map((item) => ({
      ...item,
      productTypeIds: productTypeIdsByPlaybookId.get(item.id) ?? [],
    }))
  );
}

type SymptomItem = { id: string; description: string };
type EvidenceItem = {
  id: string;
  description: string;
  actionId?: string;
  type: "photo" | "reading" | "observation" | "action" | "confirmation";
  required: boolean;
};
type CauseItem = {
  id: string;
  cause: string;
  likelihood: "high" | "medium" | "low";
  rulingEvidence: string[];
};
type QuestionItem = {
  id: string;
  question: string;
  purpose: string;
  whenToAsk?: string;
  actionId?: string;
};
type TriggerItem = { trigger: string; reason: string };

const StepSchema = z.object({
  step_id: z.string().optional().default(""),
  title: z.string().optional().default(""),
  instruction: z.string().optional().default(""),
  check: z.string().optional(),
  if_failed: z.string().optional(),
  safetyLevel: z.enum(["safe", "caution", "technician_only"]).optional(),
});

const PlaybookSchema = z.object({
  id: z.string().uuid().optional(),
  labelId: z.string().min(1),
  title: z.string().min(1),
  requiresProductType: z.boolean().optional(),
  productTypeIds: z.array(z.string().uuid()).optional(),
  steps: z.array(StepSchema).default([]),
  schemaVersion: z.number().int().optional(),
  symptoms: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .nullable()
    .optional(),
  evidenceChecklist: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        actionId: z.string().optional(),
        type: z.enum(["photo", "reading", "observation", "action", "confirmation"]),
        required: z.boolean(),
      })
    )
    .nullable()
    .optional(),
  candidateCauses: z
    .array(
      z.object({
        id: z.string().min(1),
        cause: z.string().min(1),
        likelihood: z.enum(["high", "medium", "low"]),
        rulingEvidence: z.array(z.string()),
      })
    )
    .nullable()
    .optional(),
  diagnosticQuestions: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        purpose: z.string().min(1),
        whenToAsk: z.string().optional(),
        actionId: z.string().optional(),
      })
    )
    .nullable()
    .optional(),
  escalationTriggers: z
    .array(
      z.object({
        trigger: z.string().min(1),
        reason: z.string().min(1),
      })
    )
    .nullable()
    .optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = PlaybookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid playbook payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    id,
    labelId,
    title,
    requiresProductType,
    productTypeIds,
    steps,
    schemaVersion,
    symptoms,
    evidenceChecklist,
    candidateCauses,
    diagnosticQuestions,
    escalationTriggers,
  } = parsed.data;
  const stepsWithIds = ensureStepIds(steps || []);
  const nextProductTypeIds =
    Boolean(requiresProductType) && Array.isArray(productTypeIds) ? productTypeIds : [];

  const payload = {
    labelId,
    title,
    requiresProductType: Boolean(requiresProductType),
    steps: stepsWithIds,
    updatedAt: new Date(),
    ...(schemaVersion != null && { schemaVersion }),
    ...(symptoms != null && { symptoms }),
    ...(evidenceChecklist != null && { evidenceChecklist }),
    ...(candidateCauses != null && { candidateCauses }),
    ...(diagnosticQuestions != null && { diagnosticQuestions }),
    ...(escalationTriggers != null && { escalationTriggers }),
  };

  if (id) {
    const updated = await db.transaction(async (tx) => {
      const [updatedPlaybook] = await tx
        .update(playbooks)
        .set(payload)
        .where(eq(playbooks.id, id))
        .returning();
      if (!updatedPlaybook) return null;

      await tx.delete(playbookProductTypes).where(eq(playbookProductTypes.playbookId, id));
      if (nextProductTypeIds.length > 0) {
        await tx.insert(playbookProductTypes).values(
          nextProductTypeIds.map((productTypeId) => ({
            playbookId: id,
            productTypeId,
          }))
        );
      }

      return {
        ...updatedPlaybook,
        productTypeIds: nextProductTypeIds,
      };
    });

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  }

  const created = await db.transaction(async (tx) => {
    const [createdPlaybook] = await tx
      .insert(playbooks)
      .values({
        labelId,
        title,
        requiresProductType: Boolean(requiresProductType),
        steps: stepsWithIds,
        ...(schemaVersion != null && { schemaVersion }),
        ...(symptoms != null && { symptoms }),
        ...(evidenceChecklist != null && { evidenceChecklist }),
        ...(candidateCauses != null && { candidateCauses }),
        ...(diagnosticQuestions != null && { diagnosticQuestions }),
        ...(escalationTriggers != null && { escalationTriggers }),
      })
      .returning();

    if (nextProductTypeIds.length > 0) {
      await tx.insert(playbookProductTypes).values(
        nextProductTypeIds.map((productTypeId) => ({
          playbookId: createdPlaybook.id,
          productTypeId,
        }))
      );
    }

    return {
      ...createdPlaybook,
      productTypeIds: nextProductTypeIds,
    };
  });
  return NextResponse.json(created);
}
