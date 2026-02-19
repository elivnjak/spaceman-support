import type {
  ActionRecord,
  DiagnosticPlaybook,
  EvidenceRecord,
  HypothesisState,
  PlannerOutput,
  PlannerRequest,
} from "@/lib/pipeline/diagnostic-planner";

export type SuggestedAction = {
  id: string;
  type: string;
  description: string;
  actionId?: string;
  score: number;
};

function scoreEvidenceItem(
  item: {
    id: string;
    description: string;
    type: string;
    required: boolean;
  },
  activeHypotheses: HypothesisState[]
): number {
  const typeWeight =
    item.type === "reading" ? 4 : item.type === "photo" ? 3 : item.type === "question" ? 2 : 1;
  const requiredWeight = item.required ? 3 : 0;
  const hypothesisWeight = Math.max(
    1,
    activeHypotheses.filter((h) => h.status === "active").length
  );
  return typeWeight + requiredWeight + hypothesisWeight;
}

export function suggestNextActions(input: {
  playbook: DiagnosticPlaybook;
  evidence: Record<string, EvidenceRecord>;
  hypotheses: HypothesisState[];
  limit?: number;
}): SuggestedAction[] {
  const limit = input.limit ?? 5;
  const checklist = input.playbook.evidenceChecklist ?? [];
  const missing = checklist.filter((e) => !(e.id in input.evidence));

  return missing
    .map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      actionId: item.actionId,
      score: scoreEvidenceItem(item, input.hypotheses),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function hasSufficientEvidence(
  playbook: DiagnosticPlaybook,
  evidence: Record<string, EvidenceRecord>,
  minRatio = 0.6
): { sufficient: boolean; ratio: number; requiredCount: number; collectedRequired: number } {
  const required = (playbook.evidenceChecklist ?? []).filter((e) => e.required);
  if (required.length === 0) {
    return { sufficient: true, ratio: 1, requiredCount: 0, collectedRequired: 0 };
  }
  const collectedRequired = required.filter((e) => e.id in evidence).length;
  const ratio = collectedRequired / required.length;
  return {
    sufficient: ratio >= minRatio,
    ratio,
    requiredCount: required.length,
    collectedRequired,
  };
}

function parseNumeric(value: string): number | null {
  const m = value.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function extractEvidenceFromUserMessage(
  message: string,
  outstandingRequestIds: string[]
): PlannerOutput["evidence_extracted"] {
  const trimmed = message.trim();
  if (!trimmed) return [];
  const extracted: PlannerOutput["evidence_extracted"] = [];

  for (const id of outstandingRequestIds) {
    const re = new RegExp(`\\b${id}\\s*:\\s*(.+)$`, "i");
    const m = trimmed.match(re);
    if (m?.[1]) {
      const rawValue = m[1].trim();
      const numeric = parseNumeric(rawValue);
      extracted.push({
        evidenceId: id,
        value: numeric ?? rawValue,
        confidence: "exact",
      });
    }
  }

  if (extracted.length > 0) return extracted;

  if (outstandingRequestIds.length === 1) {
    const id = outstandingRequestIds[0];
    const lower = trimmed.toLowerCase();
    if (/^(yes|y|no|n|true|false|resolved|not fixed)$/i.test(trimmed)) {
      extracted.push({
        evidenceId: id,
        value: /^(yes|y|true|resolved)$/i.test(trimmed),
        confidence: "exact",
      });
      return extracted;
    }
    const numeric = parseNumeric(trimmed);
    extracted.push({
      evidenceId: id,
      value: numeric ?? trimmed,
      confidence: numeric != null ? "exact" : "approximate",
    });
  }

  return extracted;
}

function initialConfidenceForLikelihood(likelihood: "high" | "medium" | "low"): number {
  if (likelihood === "high") return 0.75;
  if (likelihood === "medium") return 0.55;
  return 0.35;
}

function buildHypotheses(
  playbook: DiagnosticPlaybook,
  evidence: Record<string, EvidenceRecord>,
  current: HypothesisState[]
): HypothesisState[] {
  const causes = playbook.candidateCauses ?? [];
  if (causes.length === 0) return current;

  const next = causes.map((c) => {
    const matched = c.rulingEvidence.filter((e) => e in evidence).length;
    const total = Math.max(1, c.rulingEvidence.length);
    const evidenceFactor = matched / total;
    const conf = Math.min(0.99, initialConfidenceForLikelihood(c.likelihood) * 0.6 + evidenceFactor * 0.4);
    const status: HypothesisState["status"] =
      matched === 0 ? "active" : evidenceFactor >= 0.8 ? "confirmed" : "active";
    return {
      causeId: c.id,
      confidence: Number(conf.toFixed(3)),
      reasoning:
        matched > 0
          ? `${matched}/${total} ruling evidence items collected`
          : "Awaiting ruling evidence",
      status,
    };
  });

  return next.sort((a, b) => b.confidence - a.confidence);
}

function mapEvidenceTypeToRequestType(
  t: "photo" | "reading" | "observation" | "action" | "confirmation"
): PlannerRequest["type"] {
  if (t === "photo") return "photo";
  if (t === "reading") return "reading";
  if (t === "action") return "action";
  return "question";
}

export function runDeterministicPlanner(input: {
  playbook: DiagnosticPlaybook;
  evidence: Record<string, EvidenceRecord>;
  hypotheses: HypothesisState[];
  lastUserMessage: string;
  outstandingRequestIds: string[];
  actionsById: Map<string, ActionRecord>;
}): PlannerOutput {
  const evidenceExtracted = extractEvidenceFromUserMessage(
    input.lastUserMessage,
    input.outstandingRequestIds
  );

  const hypothesesUpdate = buildHypotheses(
    input.playbook,
    input.evidence,
    input.hypotheses
  );
  const sufficiency = hasSufficientEvidence(input.playbook, input.evidence, 0.6);
  const missing = (input.playbook.evidenceChecklist ?? []).filter((e) => !(e.id in input.evidence));
  const ranked = suggestNextActions({
    playbook: input.playbook,
    evidence: input.evidence,
    hypotheses: hypothesesUpdate,
    limit: 5,
  });

  const requests: PlannerRequest[] = ranked
    .map((r) => {
      const checklistItem = missing.find((m) => m.id === r.id);
      if (!checklistItem) return null;
      const reqType = mapEvidenceTypeToRequestType(checklistItem.type);
      const action = checklistItem.actionId
        ? input.actionsById.get(checklistItem.actionId)
        : undefined;
      const expectedInput =
        reqType === "reading"
          ? (action?.expectedInput as PlannerRequest["expectedInput"] | undefined)
          : checklistItem.type === "confirmation"
            ? ({ type: "boolean", options: ["yes", "no"] } as PlannerRequest["expectedInput"])
            : undefined;

      const photoSuffix =
        reqType === "photo"
          ? " Please upload a clear, close-up photo with good lighting from 2 angles."
          : "";
      return {
        type: reqType,
        id: checklistItem.id,
        prompt: `${checklistItem.description}${photoSuffix}`,
        ...(expectedInput ? { expectedInput } : {}),
      };
    })
    .filter((x): x is PlannerRequest => Boolean(x))
    .slice(0, 3);

  const topHypothesis = hypothesesUpdate[0];
  const canResolve = sufficiency.sufficient && Boolean(topHypothesis);
  if (canResolve) {
    const topCauseId = topHypothesis?.causeId ?? "unknown_cause";
    const causeText =
      (input.playbook.candidateCauses ?? []).find((c) => c.id === topCauseId)?.cause ??
      "Likely root cause identified from collected evidence";
    return {
      message: `Based on the evidence collected (${sufficiency.collectedRequired}/${sufficiency.requiredCount} required checks), here's the most likely diagnosis and next steps.`,
      phase: "resolving",
      requests: [],
      hypotheses_update: hypothesesUpdate,
      evidence_extracted: evidenceExtracted,
      resolution: {
        causeId: topCauseId,
        diagnosis: causeText,
        steps: (input.playbook.steps ?? []).slice(0, 3).map((s) => ({
          step_id: s.step_id,
          instruction: s.instruction ?? "",
          check: s.check ?? "",
        })),
        why: topHypothesis?.reasoning ?? "Required evidence threshold reached.",
      },
    };
  }

  return {
    message:
      requests.length > 0
        ? `Thanks. I still need ${missing.length} checks to narrow this down. Next, please provide the following.`
        : "I need one more confirmation before I can conclude safely.",
    phase: Object.keys(input.evidence).length > 0 ? "diagnosing" : "gathering_info",
    requests,
    hypotheses_update: hypothesesUpdate,
    evidence_extracted: evidenceExtracted,
  };
}

