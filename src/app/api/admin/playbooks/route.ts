import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { playbookProductTypes, playbooks } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import {
  CauseItemSchema,
  EvidenceItemSchema,
  StepSchema,
  TriggerItemSchema,
  playbookUsesStructuredSemantics,
} from "@/lib/playbooks/schema";

type Step = z.infer<typeof StepSchema>;

function ensureStepIds(steps: Step[]): Step[] {
  return steps.map((s) => ({
    ...s,
    step_id: s.step_id || randomUUID(),
    title: s.title ?? "",
    instruction: s.instruction ?? "",
    check: s.check,
  }));
}

async function GETHandler() {
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

const PlaybookSchema = z.object({
  id: z.string().uuid().optional(),
  labelId: z.string().min(1),
  title: z.string().min(1),
  enabled: z.boolean().optional().default(false),
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
    .array(EvidenceItemSchema)
    .nullable()
    .optional(),
  candidateCauses: z
    .array(CauseItemSchema)
    .nullable()
    .optional(),
  escalationTriggers: z
    .array(TriggerItemSchema)
    .nullable()
    .optional(),
});

async function POSTHandler(request: Request) {
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
    enabled,
    productTypeIds,
    steps,
    schemaVersion,
    symptoms,
    evidenceChecklist,
    candidateCauses,
    escalationTriggers,
  } = parsed.data;
  const stepsWithIds = ensureStepIds(steps || []);
  const nextProductTypeIds = Array.isArray(productTypeIds) ? productTypeIds : [];
  const normalizedSchemaVersion =
    schemaVersion ??
    (playbookUsesStructuredSemantics({
      evidenceChecklist: evidenceChecklist ?? [],
      candidateCauses: candidateCauses ?? [],
    })
      ? 2
      : 1);

  const payload = {
    labelId,
    title,
    enabled,
    steps: stepsWithIds,
    updatedAt: new Date(),
    schemaVersion: normalizedSchemaVersion,
    ...(symptoms != null && { symptoms }),
    ...(evidenceChecklist != null && { evidenceChecklist }),
    ...(candidateCauses != null && { candidateCauses }),
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
        enabled,
        steps: stepsWithIds,
        schemaVersion: normalizedSchemaVersion,
        ...(symptoms != null && { symptoms }),
        ...(evidenceChecklist != null && { evidenceChecklist }),
        ...(candidateCauses != null && { candidateCauses }),
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

export const GET = withApiRouteErrorLogging("/api/admin/playbooks", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/playbooks", POSTHandler);
