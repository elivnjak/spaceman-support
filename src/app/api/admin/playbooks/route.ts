import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { playbooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

type Step = {
  step_id: string;
  title: string;
  instruction: string;
  check?: string;
  if_failed?: string;
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
  return NextResponse.json(list);
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

export async function POST(request: Request) {
  const body = await request.json();
  const {
    id,
    labelId,
    title,
    steps,
    schemaVersion,
    symptoms,
    evidenceChecklist,
    candidateCauses,
    diagnosticQuestions,
    escalationTriggers,
  } = body as {
    id?: string;
    labelId: string;
    title: string;
    steps: Step[];
    schemaVersion?: number;
    symptoms?: SymptomItem[];
    evidenceChecklist?: EvidenceItem[];
    candidateCauses?: CauseItem[];
    diagnosticQuestions?: QuestionItem[];
    escalationTriggers?: TriggerItem[];
  };
  if (!labelId || !title) {
    return NextResponse.json(
      { error: "labelId and title required" },
      { status: 400 }
    );
  }
  const stepsWithIds = ensureStepIds(steps || []);

  const payload = {
    labelId,
    title,
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
    const [updated] = await db
      .update(playbooks)
      .set(payload)
      .where(eq(playbooks.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  }

  const [created] = await db
    .insert(playbooks)
    .values({
      labelId,
      title,
      steps: stepsWithIds,
      ...(schemaVersion != null && { schemaVersion }),
      ...(symptoms != null && { symptoms }),
      ...(evidenceChecklist != null && { evidenceChecklist }),
      ...(candidateCauses != null && { candidateCauses }),
      ...(diagnosticQuestions != null && { diagnosticQuestions }),
      ...(escalationTriggers != null && { escalationTriggers }),
    })
    .returning();
  return NextResponse.json(created);
}
