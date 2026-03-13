import type {
  CauseItem,
  EvidenceItem,
  EvidenceRule,
  EvidenceValueDefinition,
} from "@/lib/playbooks/schema";
import { RULE_OPERATORS, VALUE_KINDS, playbookUsesStructuredSemantics } from "@/lib/playbooks/schema";
import type { ExpectedInput } from "@/lib/types/actions";

export type PlaybookEditorActionLike = {
  id: string;
  title?: string;
  expectedInput?: ExpectedInput | null;
};

export type PlaybookValidationIssue = {
  path: string;
  message: string;
};

export type PlaybookValidationResult = {
  issues: PlaybookValidationIssue[];
  normalizedEvidenceChecklist: EvidenceItem[];
  normalizedCandidateCauses: CauseItem[];
  schemaVersion: number;
};

export function expectedInputToValueDefinition(
  expectedInput: ExpectedInput | null | undefined
): EvidenceValueDefinition | undefined {
  if (!expectedInput?.type) return undefined;
  if (expectedInput.type === "photo") {
    return { kind: "photo" };
  }
  if (expectedInput.type === "number") {
    return {
      kind: "number",
      unit: expectedInput.unit?.trim() || undefined,
      notes:
        expectedInput.range && Number.isFinite(expectedInput.range.min) && Number.isFinite(expectedInput.range.max)
          ? `Expected range ${expectedInput.range.min} to ${expectedInput.range.max}`
          : undefined,
    };
  }
  if (expectedInput.type === "boolean") {
    return {
      kind: "boolean",
      options:
        expectedInput.options?.map((option) => option.trim()).filter(Boolean).length
          ? expectedInput.options.map((option) => option.trim()).filter(Boolean)
          : ["Yes", "No"],
    };
  }
  if (expectedInput.type === "enum") {
    return {
      kind: "enum",
      options: expectedInput.options?.map((option) => option.trim()).filter(Boolean) ?? [],
    };
  }
  return { kind: "text" };
}

export function inferValueDefinitionFromEvidenceType(
  evidenceType: EvidenceItem["type"]
): EvidenceValueDefinition | undefined {
  switch (evidenceType) {
    case "photo":
      return { kind: "photo" };
    case "reading":
      return { kind: "number" };
    case "confirmation":
      return { kind: "boolean", options: ["Yes", "No"] };
    default:
      return { kind: "text" };
  }
}

export function getEffectiveValueDefinition(
  evidenceItem: EvidenceItem,
  actionsById: Map<string, PlaybookEditorActionLike>
): EvidenceValueDefinition | undefined {
  const linkedAction = evidenceItem.actionId ? actionsById.get(evidenceItem.actionId) : undefined;
  return (
    expectedInputToValueDefinition(linkedAction?.expectedInput) ??
    evidenceItem.valueDefinition ??
    inferValueDefinitionFromEvidenceType(evidenceItem.type)
  );
}

export function normalizeEvidenceChecklistWithActions(
  evidenceChecklist: EvidenceItem[],
  actionsById: Map<string, PlaybookEditorActionLike>
): EvidenceItem[] {
  return evidenceChecklist.map((item) => {
    const actionValueDefinition = item.actionId
      ? expectedInputToValueDefinition(actionsById.get(item.actionId)?.expectedInput)
      : undefined;
    return {
      ...item,
      actionId: item.actionId?.trim() || undefined,
      ...(item.guideImageIds?.length
        ? {
            guideImageIds: Array.from(
              new Set(item.guideImageIds.map((id) => id.trim()).filter(Boolean))
            ),
          }
        : {}),
      ...(actionValueDefinition
        ? { valueDefinition: actionValueDefinition }
        : item.valueDefinition
          ? { valueDefinition: sanitizeValueDefinition(item.valueDefinition) }
          : {}),
    };
  });
}

export function getAllowedRuleOperators(
  valueDefinition: EvidenceValueDefinition | undefined
): (typeof RULE_OPERATORS)[number][] {
  switch (valueDefinition?.kind) {
    case "number":
      return ["exists", "missing", "equals", "not_equals", "between", "not_between"];
    case "boolean":
    case "enum":
      return ["exists", "missing", "equals", "not_equals", "in", "not_in"];
    case "photo":
      return ["exists", "missing"];
    case "text":
    default:
      return ["exists", "missing", "equals", "not_equals", "in", "not_in"];
  }
}

export function getRuleSelectableValues(
  valueDefinition: EvidenceValueDefinition | undefined
): string[] {
  if (!valueDefinition) return [];
  if (valueDefinition.kind === "boolean" && (!valueDefinition.options || valueDefinition.options.length === 0)) {
    return ["Yes", "No"];
  }
  return valueDefinition.options ?? [];
}

function sanitizeValueDefinition(valueDefinition: EvidenceValueDefinition): EvidenceValueDefinition {
  return {
    ...(valueDefinition.kind && VALUE_KINDS.includes(valueDefinition.kind) ? { kind: valueDefinition.kind } : {}),
    ...(valueDefinition.options?.length
      ? {
          options: valueDefinition.options.map((option) => option.trim()).filter(Boolean),
        }
      : {}),
    ...(valueDefinition.unit?.trim() ? { unit: valueDefinition.unit.trim() } : {}),
    ...(valueDefinition.unknownValues?.length
      ? {
          unknownValues: valueDefinition.unknownValues.map((value) => value.trim()).filter(Boolean),
        }
      : {}),
    ...(valueDefinition.notes?.trim() ? { notes: valueDefinition.notes.trim() } : {}),
  };
}

function normalizeRuleValues(rule: EvidenceRule): EvidenceRule {
  const next: EvidenceRule = {
    evidenceId: rule.evidenceId.trim(),
    ...(rule.operator ? { operator: rule.operator } : {}),
    ...(typeof rule.min === "number" ? { min: rule.min } : {}),
    ...(typeof rule.max === "number" ? { max: rule.max } : {}),
    ...(rule.rationale?.trim() ? { rationale: rule.rationale.trim() } : {}),
  };
  if (rule.values?.length) {
    next.values = rule.values
      .map((value) => String(value).trim())
      .filter(Boolean);
  } else if (typeof rule.value !== "undefined") {
    next.values = [String(rule.value)];
  }
  return next;
}

export function normalizeCandidateCauses(candidateCauses: CauseItem[]): CauseItem[] {
  return candidateCauses.map((cause) => ({
    ...cause,
    rulingEvidence: cause.rulingEvidence.map((item) => item.trim()).filter(Boolean),
    ...(cause.supportRules?.length
      ? { supportRules: cause.supportRules.map(normalizeRuleValues) }
      : {}),
    ...(cause.excludeRules?.length
      ? { excludeRules: cause.excludeRules.map(normalizeRuleValues) }
      : {}),
  }));
}

function addIssue(
  issues: PlaybookValidationIssue[],
  path: string,
  message: string
) {
  issues.push({ path, message });
}

function validateValueDefinition(
  issues: PlaybookValidationIssue[],
  valueDefinition: EvidenceValueDefinition | undefined,
  path: string
) {
  if (!valueDefinition?.kind) return;
  if (!VALUE_KINDS.includes(valueDefinition.kind)) {
    addIssue(issues, path, "Unsupported value definition kind.");
    return;
  }
  if ((valueDefinition.kind === "enum" || valueDefinition.kind === "boolean") && !getRuleSelectableValues(valueDefinition).length) {
    addIssue(issues, path, "Enum and boolean evidence must have at least one option.");
  }
}

function validateRule(
  issues: PlaybookValidationIssue[],
  rule: EvidenceRule,
  path: string,
  evidenceById: Map<string, EvidenceItem>,
  actionsById: Map<string, PlaybookEditorActionLike>
) {
  if (!rule.evidenceId?.trim()) {
    addIssue(issues, `${path}.evidenceId`, "Rule evidence is required.");
    return;
  }
  const evidence = evidenceById.get(rule.evidenceId.trim());
  if (!evidence) {
    addIssue(issues, `${path}.evidenceId`, "Rule references unknown evidence.");
    return;
  }
  const valueDefinition = getEffectiveValueDefinition(evidence, actionsById);
  const operator = rule.operator ?? "equals";
  if (!getAllowedRuleOperators(valueDefinition).includes(operator)) {
    addIssue(issues, `${path}.operator`, "Rule operator is not valid for this evidence type.");
  }

  if (operator === "between" || operator === "not_between") {
    if (typeof rule.min !== "number" || typeof rule.max !== "number") {
      addIssue(issues, path, "Numeric range rules require both min and max.");
    }
    return;
  }

  if (operator === "exists" || operator === "missing") {
    return;
  }

  const values = rule.values?.map((value) => String(value).trim()).filter(Boolean) ?? [];
  if (values.length === 0) {
    addIssue(issues, `${path}.values`, "Rule values are required for this operator.");
    return;
  }

  const selectableValues = getRuleSelectableValues(valueDefinition);
  if (selectableValues.length > 0) {
    for (const value of values) {
      if (!selectableValues.includes(value)) {
        addIssue(
          issues,
          `${path}.values`,
          `Value "${value}" is not a valid option for evidence ${rule.evidenceId}.`
        );
      }
    }
  }
}

export function validateAndNormalizePlaybookV2(input: {
  evidenceChecklist: EvidenceItem[];
  candidateCauses: CauseItem[];
  actionsById: Map<string, PlaybookEditorActionLike>;
  schemaVersion?: number | null;
}): PlaybookValidationResult {
  const issues: PlaybookValidationIssue[] = [];
  const normalizedEvidenceChecklist = normalizeEvidenceChecklistWithActions(
    input.evidenceChecklist,
    input.actionsById
  );
  const normalizedCandidateCauses = normalizeCandidateCauses(input.candidateCauses);
  const evidenceById = new Map<string, EvidenceItem>();
  const causeIds = new Set<string>();

  normalizedEvidenceChecklist.forEach((item, index) => {
    const path = `evidenceChecklist.${index}`;
    if (!item.id.trim()) {
      addIssue(issues, `${path}.id`, "Evidence ID is required.");
      return;
    }
    if (evidenceById.has(item.id.trim())) {
      addIssue(issues, `${path}.id`, "Evidence IDs must be unique.");
    }
    evidenceById.set(item.id.trim(), item);
    if (item.actionId && !input.actionsById.has(item.actionId)) {
      addIssue(issues, `${path}.actionId`, "Linked action could not be found.");
    }
    if (!item.description.trim()) {
      addIssue(issues, `${path}.description`, "Evidence description is required.");
    }
    validateValueDefinition(issues, item.valueDefinition, `${path}.valueDefinition`);
  });

  normalizedCandidateCauses.forEach((cause, index) => {
    const path = `candidateCauses.${index}`;
    if (!cause.id.trim()) {
      addIssue(issues, `${path}.id`, "Cause ID is required.");
    } else if (causeIds.has(cause.id.trim())) {
      addIssue(issues, `${path}.id`, "Cause IDs must be unique.");
    } else {
      causeIds.add(cause.id.trim());
    }
    if (!cause.cause.trim()) {
      addIssue(issues, `${path}.cause`, "Cause description is required.");
    }
    cause.rulingEvidence.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceById.has(evidenceId)) {
        addIssue(
          issues,
          `${path}.rulingEvidence.${evidenceIndex}`,
          `Unknown evidence reference "${evidenceId}".`
        );
      }
    });
    cause.supportRules?.forEach((rule, ruleIndex) =>
      validateRule(
        issues,
        rule,
        `${path}.supportRules.${ruleIndex}`,
        evidenceById,
        input.actionsById
      )
    );
    cause.excludeRules?.forEach((rule, ruleIndex) =>
      validateRule(
        issues,
        rule,
        `${path}.excludeRules.${ruleIndex}`,
        evidenceById,
        input.actionsById
      )
    );
  });

  const schemaVersion =
    input.schemaVersion ??
    (playbookUsesStructuredSemantics({
      evidenceChecklist: normalizedEvidenceChecklist,
      candidateCauses: normalizedCandidateCauses,
    })
      ? 2
      : 1);

  return {
    issues,
    normalizedEvidenceChecklist,
    normalizedCandidateCauses,
    schemaVersion,
  };
}
