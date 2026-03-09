import type {
  ActionRecord,
  DiagnosticPlaybook,
  EvidenceRecord,
  PlannerOutput,
} from "./diagnostic-planner";

function mapChecklistTypeToPlannerRequestType(
  type: "photo" | "reading" | "observation" | "action" | "confirmation"
): PlannerOutput["requests"][number]["type"] {
  if (type === "photo") return "photo";
  if (type === "reading") return "reading";
  if (type === "action") return "action";
  return "question";
}

export function preventRepeatedChecklistRequests(input: {
  requests: PlannerOutput["requests"];
  playbook: DiagnosticPlaybook;
  evidence: Record<string, EvidenceRecord>;
  evidenceExtracted: PlannerOutput["evidence_extracted"];
  actionsById: Map<string, ActionRecord>;
}): {
  requests: PlannerOutput["requests"];
  removedRequestIds: string[];
  fallbackEvidenceId?: string;
} {
  const checklist = input.playbook.evidenceChecklist ?? [];
  if (!checklist.length || input.requests.length === 0) {
    return { requests: input.requests, removedRequestIds: [] };
  }

  const hasUsableEvidenceRecord = (record: EvidenceRecord | undefined): boolean => {
    if (!record) return false;
    if (record.confidence === "uncertain") return false;
    if (record.value == null) return false;
    if (typeof record.value === "string") {
      const normalized = record.value.trim().toLowerCase();
      if (
        normalized.length === 0 ||
        normalized === "uncertain" ||
        normalized === "unknown" ||
        normalized === "not sure" ||
        normalized === "skip"
      ) {
        return false;
      }
    }
    return true;
  };

  const requestIdToEvidenceId = new Map<string, string>();
  for (const item of checklist) {
    requestIdToEvidenceId.set(item.id, item.id);
    if (item.actionId) requestIdToEvidenceId.set(item.actionId, item.id);
  }

  const effectiveEvidenceIds = new Set<string>();
  for (const [evidenceId, record] of Object.entries(input.evidence)) {
    if (hasUsableEvidenceRecord(record)) {
      effectiveEvidenceIds.add(evidenceId);
    }
  }
  for (const extracted of input.evidenceExtracted) {
    if (
      extracted?.evidenceId &&
      hasUsableEvidenceRecord(
        extracted
          ? {
              value: extracted.value,
              type: typeof extracted.value,
              confidence: extracted.confidence,
              photoAnalysis: extracted.photoAnalysis,
              collectedAt: "",
              turn: 0,
            }
          : undefined
      )
    ) {
      effectiveEvidenceIds.add(extracted.evidenceId);
    }
  }

  const removedRequestIds: string[] = [];
  const filtered = input.requests.filter((req) => {
    const evidenceId = requestIdToEvidenceId.get(req.id);
    if (!evidenceId) {
      if (effectiveEvidenceIds.has(req.id)) {
        removedRequestIds.push(req.id);
        return false;
      }
      return true;
    }
    if (!effectiveEvidenceIds.has(evidenceId)) return true;
    removedRequestIds.push(req.id);
    return false;
  });

  if (filtered.length > 0) {
    return { requests: filtered, removedRequestIds };
  }

  const fallbackItem =
    checklist.find((item) => item.required && !effectiveEvidenceIds.has(item.id)) ??
    chooseStructuredFallbackEvidence({
      checklist,
      candidateCauses: input.playbook.candidateCauses ?? [],
      effectiveEvidenceIds,
    });
  if (!fallbackItem) {
    return { requests: filtered, removedRequestIds };
  }

  const mappedType = mapChecklistTypeToPlannerRequestType(fallbackItem.type);
  const linkedAction = fallbackItem.actionId
    ? input.actionsById.get(fallbackItem.actionId)
    : undefined;
  const actionExpectedInput =
    linkedAction?.expectedInput &&
    typeof linkedAction.expectedInput === "object"
      ? (linkedAction.expectedInput as PlannerOutput["requests"][number]["expectedInput"])
      : undefined;
  const expectedInput =
    fallbackItem.type === "confirmation"
      ? ({
          type: "boolean",
          options: ["Yes", "No"],
        } as PlannerOutput["requests"][number]["expectedInput"])
      : actionExpectedInput;
  const photoSuffix =
    mappedType === "photo"
      ? " Please upload a clear, close-up photo with good lighting from 2 angles."
      : "";
  const fallbackRequest: PlannerOutput["requests"][number] = {
    type: mappedType,
    id: fallbackItem.actionId ?? fallbackItem.id,
    prompt: `${fallbackItem.description}${photoSuffix}`,
    ...(expectedInput ? { expectedInput } : {}),
  };

  return {
    requests: [fallbackRequest],
    removedRequestIds,
    fallbackEvidenceId: fallbackItem.id,
  };
}

function chooseStructuredFallbackEvidence(input: {
  checklist: NonNullable<DiagnosticPlaybook["evidenceChecklist"]>;
  candidateCauses: NonNullable<DiagnosticPlaybook["candidateCauses"]>;
  effectiveEvidenceIds: Set<string>;
}) {
  const structuredReferenceCounts = new Map<string, number>();
  for (const cause of input.candidateCauses) {
    for (const rule of [...(cause.supportRules ?? []), ...(cause.excludeRules ?? [])]) {
      structuredReferenceCounts.set(
        rule.evidenceId,
        (structuredReferenceCounts.get(rule.evidenceId) ?? 0) + 1
      );
    }
  }

  const candidates = input.checklist
    .filter((item) => !input.effectiveEvidenceIds.has(item.id))
    .map((item) => ({
      item,
      score: structuredReferenceCounts.get(item.id) ?? 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.item;
}
