export type PlaybookStep = {
  step_id: string;
  title?: string;
  instruction?: string;
  check?: string;
  if_failed?: string;
  safetyLevel?: "safe" | "caution" | "technician_only";
};

export type LLMStep = {
  step_id: string;
  instruction?: string;
  check?: string;
};

export type ValidationResult = {
  valid: boolean;
  invalidStepIds: string[];
};

export function validateGrounding(
  llmSteps: LLMStep[],
  playbookSteps: PlaybookStep[]
): ValidationResult {
  const validIds = new Set(playbookSteps.map((s) => s.step_id));
  const invalid = llmSteps.filter((s) => !validIds.has(s.step_id));
  return {
    valid: invalid.length === 0,
    invalidStepIds: invalid.map((s) => s.step_id),
  };
}

/**
 * Replace LLM step text with canonical playbook text and sort steps by playbook order.
 * Playbook step array order is the intended execution order (e.g. "turn off" before "remove panel").
 */
export function replaceWithCanonicalAndSort(
  llmSteps: LLMStep[],
  playbookSteps: PlaybookStep[]
): { step_id: string; instruction: string; check?: string }[] {
  const stepById = new Map(playbookSteps.map((s) => [s.step_id, s]));
  const orderByStepId = new Map(playbookSteps.map((s, i) => [s.step_id, i]));
  return llmSteps
    .filter((s) => stepById.has(s.step_id))
    .map((s) => {
      const canonical = stepById.get(s.step_id)!;
      return {
        step_id: s.step_id,
        instruction: canonical.instruction ?? s.instruction ?? "",
        check: canonical.check ?? s.check,
      };
    })
    .sort((a, b) => (orderByStepId.get(a.step_id) ?? 0) - (orderByStepId.get(b.step_id) ?? 0));
}
