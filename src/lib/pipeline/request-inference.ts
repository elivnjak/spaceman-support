import type {
  DiagnosticPlaybook,
  PlannerOutput,
  PlannerRequest,
} from "./diagnostic-planner";

export function mergeInferredEvidenceWithPlannerOutput(input: {
  plannerEvidence: PlannerOutput["evidence_extracted"];
  inferredEvidence: PlannerOutput["evidence_extracted"];
}): PlannerOutput["evidence_extracted"] {
  if (input.inferredEvidence.length === 0) {
    return input.plannerEvidence;
  }

  const merged = [...input.plannerEvidence];
  const indexByEvidenceId = new Map<string, number>();
  for (const [index, item] of merged.entries()) {
    indexByEvidenceId.set(item.evidenceId, index);
  }

  for (const inferred of input.inferredEvidence) {
    const existingIndex = indexByEvidenceId.get(inferred.evidenceId);
    if (existingIndex === undefined) {
      indexByEvidenceId.set(inferred.evidenceId, merged.length);
      merged.push(inferred);
      continue;
    }

    const existing = merged[existingIndex];
    if (
      existing.value !== inferred.value ||
      existing.confidence !== inferred.confidence ||
      existing.photoAnalysis !== inferred.photoAnalysis
    ) {
      merged[existingIndex] = inferred;
    }
  }

  return merged;
}

function normalizeUserMessage(content: string): string {
  return content.trim().toLowerCase();
}

function normalizeEnumValue(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function parseYesNoMessage(content: string): boolean | null {
  const n = normalizeUserMessage(content);
  if (!n) return null;
  const yesPatterns = [
    /^y(es|eah|ep)?\.?$/i,
    /^sure\.?$/i,
    /^i do\.?$/i,
    /^know both\.?$/i,
    /^yes[, ]+i know (them|both)\.?$/i,
  ];
  const noPatterns = [
    /^n(o|ope)?\.?$/i,
    /^nah\.?$/i,
    /^i don'?t\.?$/i,
    /^i don'?t know\.?$/i,
    /^i don'?t know (them|both)\.?$/i,
    /^not sure\.?$/i,
    /^no[, ]+i don'?t know (them|both)\.?$/i,
  ];
  if (yesPatterns.some((pattern) => pattern.test(n))) return true;
  if (noPatterns.some((pattern) => pattern.test(n))) return false;
  return null;
}

function isYesNoOptionSet(options: string[] | undefined): boolean {
  if (!options || options.length === 0) return false;
  const normalized = new Set(options.map((option) => option.trim().toLowerCase()));
  return normalized.has("yes") && normalized.has("no");
}

function parseEnumMessage(
  content: string,
  options: string[] | undefined
): string | null {
  if (!options || options.length === 0) return null;
  const normalizedMessage = normalizeEnumValue(content);
  if (!normalizedMessage) return null;
  const exactMatch = options.find(
    (option) => normalizeEnumValue(option) === normalizedMessage
  );
  return exactMatch ?? null;
}

export function inferEvidenceFromOutstandingRequest(input: {
  message: string;
  outstandingRequestIds: string[];
  playbook: DiagnosticPlaybook;
  previousRequests?: PlannerRequest[];
}): PlannerOutput["evidence_extracted"] {
  if (input.outstandingRequestIds.length !== 1) return [];
  const requestId = input.outstandingRequestIds[0];
  if (!requestId) return [];

  const checklistItem = (input.playbook.evidenceChecklist ?? []).find(
    (item) => item.id === requestId || item.actionId === requestId
  );
  if (!checklistItem) return [];

  const activeRequest = input.previousRequests?.find((request) => request.id === requestId);
  const expectedType = activeRequest?.expectedInput?.type?.trim().toLowerCase();
  const expectedOptions = activeRequest?.expectedInput?.options;

  if (expectedType === "number") {
    const match = input.message.match(/-?\d+(?:\.\d+)?/);
    if (!match) return [];
    return [
      {
        evidenceId: checklistItem.id,
        value: Number(match[0]),
        confidence: "exact",
      },
    ];
  }

  if (expectedType === "enum" && expectedOptions && !isYesNoOptionSet(expectedOptions)) {
    const parsed = parseEnumMessage(input.message, expectedOptions);
    if (parsed === null) return [];
    return [
      {
        evidenceId: checklistItem.id,
        value: parsed,
        confidence: "exact",
      },
    ];
  }

  const shouldParseYesNo =
    expectedType === "boolean" ||
    isYesNoOptionSet(expectedOptions) ||
    (checklistItem.type === "confirmation" && !expectedType);

  if (!shouldParseYesNo) {
    return [];
  }

  const parsed = parseYesNoMessage(input.message);
  if (parsed === null) return [];
  return [
    {
      evidenceId: checklistItem.id,
      value: parsed,
      confidence: "exact",
    },
  ];
}
