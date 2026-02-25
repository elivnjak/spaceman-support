import type {
  ActionRecord,
  CandidateCause,
  DiagnosticPlaybook,
  EvidenceRecord,
  HypothesisState,
  PlannerOutput,
  PlannerRequest,
} from "@/lib/pipeline/diagnostic-planner";
import { MANIFEST_DEFAULTS } from "@/lib/intent/defaults";

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
  minRatio = MANIFEST_DEFAULTS.escalation.evidenceRatioMinimum
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = value.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const parsed = Number(m[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  if (/^(true|yes|y|1|resolved|done)$/i.test(value.trim())) return true;
  if (/^(false|no|n|0|not fixed|unable)$/i.test(value.trim())) return false;
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLowerCase();
  return null;
}

function evaluateRule(
  rule: NonNullable<CandidateCause["supportRules"]>[number],
  evidence: Record<string, EvidenceRecord>
): { known: boolean; matched: boolean } {
  const record = evidence[rule.evidenceId];
  if (!record) return { known: false, matched: false };

  const expected = rule.value;
  const operator = rule.operator;
  const observed = record.value;

  if (operator === "in" || operator === "not_in") {
    const expectedArr = Array.isArray(expected) ? expected : [expected];
    const observedText = toText(observed);
    if (observedText == null) return { known: false, matched: false };
    const normalizedExpected = expectedArr.map((v) => String(v).toLowerCase());
    const inSet = normalizedExpected.includes(observedText);
    return { known: true, matched: operator === "in" ? inSet : !inSet };
  }

  if (operator === "contains" || operator === "not_contains") {
    const observedText = toText(observed);
    const expectedText = toText(expected);
    if (observedText == null || expectedText == null) return { known: false, matched: false };
    const contains = observedText.includes(expectedText);
    return { known: true, matched: operator === "contains" ? contains : !contains };
  }

  if (operator === "=" || operator === "!=") {
    const observedBool = toBoolean(observed);
    const expectedBool = toBoolean(expected);
    if (observedBool != null && expectedBool != null) {
      const equal = observedBool === expectedBool;
      return { known: true, matched: operator === "=" ? equal : !equal };
    }
    const observedNum = toNumber(observed);
    const expectedNum = toNumber(expected);
    if (observedNum != null && expectedNum != null) {
      const equal = observedNum === expectedNum;
      return { known: true, matched: operator === "=" ? equal : !equal };
    }
    const observedText = toText(observed);
    const expectedText = toText(expected);
    if (observedText == null || expectedText == null) return { known: false, matched: false };
    const equal = observedText === expectedText;
    return { known: true, matched: operator === "=" ? equal : !equal };
  }

  const observedNum = toNumber(observed);
  const expectedNum = toNumber(expected);
  if (observedNum == null || expectedNum == null) return { known: false, matched: false };
  if (operator === ">") return { known: true, matched: observedNum > expectedNum };
  if (operator === ">=") return { known: true, matched: observedNum >= expectedNum };
  if (operator === "<") return { known: true, matched: observedNum < expectedNum };
  return { known: true, matched: observedNum <= expectedNum };
}

function buildHypotheses(
  playbook: DiagnosticPlaybook,
  evidence: Record<string, EvidenceRecord>,
  current: HypothesisState[]
): HypothesisState[] {
  const causes = playbook.candidateCauses ?? [];
  if (causes.length === 0) return current;

  const next = causes.map((c) => {
    let supportScore = 0;
    let contradictionScore = 0;
    let evaluatedRules = 0;

    for (const rule of c.supportRules ?? []) {
      const weight = rule.weight ?? 1;
      const result = evaluateRule(rule, evidence);
      if (!result.known) continue;
      evaluatedRules += 1;
      if (result.matched) supportScore += weight;
      else contradictionScore += weight;
    }

    for (const rule of c.contradictionRules ?? []) {
      const weight = rule.weight ?? 1;
      const result = evaluateRule(rule, evidence);
      if (!result.known) continue;
      evaluatedRules += 1;
      if (result.matched) contradictionScore += weight;
    }

    const matched = c.rulingEvidence.filter((e) => e in evidence).length;
    const total = Math.max(1, c.rulingEvidence.length);
    const legacyEvidenceFactor = matched / total;
    supportScore += legacyEvidenceFactor * 0.4;

    const signalTotal = Math.max(1, supportScore + contradictionScore);
    const supportFactor = supportScore / signalTotal;
    const contradictionFactor = contradictionScore / signalTotal;
    const base = initialConfidenceForLikelihood(c.likelihood);
    const conf = Math.min(
      0.99,
      Math.max(
        0.01,
        base * 0.45 +
          legacyEvidenceFactor * 0.15 +
          supportFactor * 0.45 -
          contradictionFactor * 0.55
      )
    );
    const status: HypothesisState["status"] =
      contradictionScore > supportScore && contradictionScore >= 1
        ? "ruled_out"
        : supportScore >= 1 && contradictionScore === 0 && legacyEvidenceFactor >= 0.5
          ? "confirmed"
          : "active";
    return {
      causeId: c.id,
      confidence: Number(conf.toFixed(3)),
      reasoning: `support=${supportScore.toFixed(2)}, contradiction=${contradictionScore.toFixed(
        2
      )}, evidence=${matched}/${total}, rulesEvaluated=${evaluatedRules}`,
      status,
    };
  });

  return next.sort((a, b) => b.confidence - a.confidence);
}

function shouldResolveFromHypotheses(input: {
  hypotheses: HypothesisState[];
  evidenceSufficiency: {
    ratio: number;
    sufficient: boolean;
    requiredCount: number;
    collectedRequired: number;
  };
  missingRequiredCount: number;
}): boolean {
  const top = input.hypotheses[0];
  if (!top) return false;
  if (!input.evidenceSufficiency.sufficient) return false;
  if (top.status === "ruled_out") return false;

  const second = input.hypotheses[1];
  const gap = second ? top.confidence - second.confidence : top.confidence;
  const hasStrongTop =
    top.confidence >= MANIFEST_DEFAULTS.confidence.hypothesisResolutionMinConfidence;
  const hasClearGap =
    gap >= MANIFEST_DEFAULTS.confidence.hypothesisResolutionMinGap;
  const hasHighEvidenceCoverage =
    input.evidenceSufficiency.ratio >=
      MANIFEST_DEFAULTS.confidence.hypothesisMinEvidenceCoverage ||
    input.evidenceSufficiency.collectedRequired === input.evidenceSufficiency.requiredCount;
  const noMajorEvidenceGaps =
    input.missingRequiredCount === 0 ||
    input.evidenceSufficiency.ratio >=
      MANIFEST_DEFAULTS.confidence.hypothesisMinEvidenceCoverage;

  return hasStrongTop && hasClearGap && hasHighEvidenceCoverage && noMajorEvidenceGaps;
}

function mapEvidenceTypeToRequestType(
  t: "photo" | "reading" | "observation" | "action" | "confirmation"
): PlannerRequest["type"] {
  if (t === "photo") return "photo";
  if (t === "reading") return "reading";
  if (t === "action") return "action";
  return "question";
}

function tokenizeText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3);
}

function inferActionFromChecklistItem(params: {
  checklistDescription: string;
  requestType: PlannerRequest["type"];
  actionsById: Map<string, ActionRecord>;
}): ActionRecord | undefined {
  const descTokens = new Set(tokenizeText(params.checklistDescription));
  const candidates = Array.from(params.actionsById.values());
  let best: { action: ActionRecord; score: number } | null = null;

  for (const action of candidates) {
    const expectedInput = action.expectedInput as
      | { type?: string; options?: string[] }
      | undefined;
    const inputType = expectedInput?.type?.toLowerCase();
    if (params.requestType === "reading" && inputType !== "number") continue;
    if (params.requestType === "photo" && inputType !== "photo") continue;
    if (params.requestType === "question" && inputType === "photo") continue;

    const actionText = `${action.title} ${action.instructions}`;
    const actionTokens = tokenizeText(actionText);
    const overlap = actionTokens.filter((t) => descTokens.has(t)).length;
    if (overlap === 0) continue;
    const score = overlap / Math.max(1, descTokens.size);
    if (!best || score > best.score) best = { action, score };
  }

  return best?.score && best.score >= 0.2 ? best.action : undefined;
}

function buildConversationalOpener(req: PlannerRequest): string {
  switch (req.type) {
    case "reading":
      return `To help narrow this down — ${req.prompt.toLowerCase().startsWith("what") ? req.prompt : `can you check: ${req.prompt}`}`;
    case "photo":
      return `I'd like to take a closer look. ${req.prompt}`;
    case "action":
      return `Let's start with a quick check. ${req.prompt}`;
    default:
      return `To help narrow this down — ${req.prompt}`;
  }
}

function buildFollowUpMessage(req: PlannerRequest, remainingCount: number): string {
  const progress = remainingCount > 1 ? ` (${remainingCount} checks remaining)` : " (almost there)";
  switch (req.type) {
    case "reading":
      return `Got it, thanks.${progress} Next — ${req.prompt}`;
    case "photo":
      return `Thanks for that.${progress} Now I need a photo: ${req.prompt}`;
    case "action":
      return `Thanks.${progress} Next, please: ${req.prompt}`;
    default:
      return `Got it.${progress} ${req.prompt}`;
  }
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
  const effectiveEvidence: Record<string, EvidenceRecord> = {
    ...input.evidence,
  };
  for (const extracted of evidenceExtracted) {
    effectiveEvidence[extracted.evidenceId] = {
      value: extracted.value,
      type: typeof extracted.value,
      confidence: extracted.confidence,
      collectedAt: new Date().toISOString(),
      turn: 0,
    };
  }

  const hypothesesUpdate = buildHypotheses(
    input.playbook,
    effectiveEvidence,
    input.hypotheses
  );
  const sufficiency = hasSufficientEvidence(input.playbook, effectiveEvidence, 0.6);
  const missing = (input.playbook.evidenceChecklist ?? []).filter((e) => !(e.id in effectiveEvidence));
  const missingRequiredCount = missing.filter((m) => m.required).length;
  const ranked = suggestNextActions({
    playbook: input.playbook,
    evidence: effectiveEvidence,
    hypotheses: hypothesesUpdate,
    limit: 5,
  });

  const requests: PlannerRequest[] = ranked
    .map((r) => {
      const checklistItem = missing.find((m) => m.id === r.id);
      if (!checklistItem) return null;
      const reqType = mapEvidenceTypeToRequestType(checklistItem.type);
      const actionFromId = checklistItem.actionId
        ? input.actionsById.get(checklistItem.actionId)
        : undefined;
      const action =
        actionFromId ??
        inferActionFromChecklistItem({
          checklistDescription: checklistItem.description,
          requestType: reqType,
          actionsById: input.actionsById,
        });
      const expectedInput =
        checklistItem.type === "confirmation"
          ? ({ type: "boolean", options: ["yes", "no"] } as PlannerRequest["expectedInput"])
          : (action?.expectedInput as PlannerRequest["expectedInput"] | undefined);

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
    .slice(0, 1);

  const topHypothesis = hypothesesUpdate[0];
  const fallbackResolve =
    requests.length === 0 &&
    sufficiency.sufficient &&
    Boolean(topHypothesis) &&
    topHypothesis.status !== "ruled_out";
  const canResolve =
    fallbackResolve ||
    (Boolean(topHypothesis) &&
      shouldResolveFromHypotheses({
        hypotheses: hypothesesUpdate,
        evidenceSufficiency: sufficiency,
        missingRequiredCount,
      }));
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

  if (requests.length === 0) {
    return {
      message:
        "I've collected all required checks, but the evidence is contradictory. I'll escalate this to support so a technician can review safely.",
      phase: "escalated",
      requests: [],
      hypotheses_update: hypothesesUpdate,
      evidence_extracted: evidenceExtracted,
      escalation_reason:
        "No additional diagnostic requests available and confidence is insufficient for a safe autonomous resolution.",
    };
  }

  const hasExistingEvidence = Object.keys(effectiveEvidence).length > 0;
  const nextReq = requests[0];
  let message: string;
  if (!nextReq) {
    message = "I need one more confirmation before I can conclude safely.";
  } else if (!hasExistingEvidence) {
    message = buildConversationalOpener(nextReq);
  } else {
    message = buildFollowUpMessage(nextReq, missing.length);
  }

  return {
    message,
    phase: hasExistingEvidence ? "diagnosing" : "gathering_info",
    requests,
    hypotheses_update: hypothesesUpdate,
    evidence_extracted: evidenceExtracted,
  };
}

