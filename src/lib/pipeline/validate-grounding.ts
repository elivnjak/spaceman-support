export type PlaybookStep = {
  step_id: string;
  title?: string;
  instruction?: string;
  check?: string;
  if_failed?: string;
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
