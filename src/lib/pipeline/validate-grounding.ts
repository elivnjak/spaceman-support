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
  /** Step IDs where the LLM rewrote the instruction beyond acceptable similarity */
  driftedStepIds: string[];
};

/**
 * Normalise text for comparison: lowercase, collapse whitespace, strip punctuation.
 */
function normalise(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple token-overlap similarity (Jaccard on word sets).
 * Returns 0–1 where 1 = identical word sets.
 */
function wordOverlap(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

const INSTRUCTION_DRIFT_THRESHOLD = 0.35;

export function validateGrounding(
  llmSteps: LLMStep[],
  playbookSteps: PlaybookStep[]
): ValidationResult {
  const stepMap = new Map(playbookSteps.map((s) => [s.step_id, s]));
  const invalidStepIds: string[] = [];
  const driftedStepIds: string[] = [];

  for (const ls of llmSteps) {
    const pb = stepMap.get(ls.step_id);
    if (!pb) {
      invalidStepIds.push(ls.step_id);
      continue;
    }
    if (pb.instruction && ls.instruction) {
      const sim = wordOverlap(normalise(pb.instruction), normalise(ls.instruction));
      if (sim < INSTRUCTION_DRIFT_THRESHOLD) {
        driftedStepIds.push(ls.step_id);
      }
    }
  }

  return {
    valid: invalidStepIds.length === 0 && driftedStepIds.length === 0,
    invalidStepIds,
    driftedStepIds,
  };
}

/**
 * Replace LLM-rewritten instructions with the authoritative playbook text.
 * Preserves the LLM's step selection and check text but ensures the user
 * sees exactly what was authored in the playbook.
 */
export function enforcePlaybookInstructions(
  llmSteps: LLMStep[],
  playbookSteps: PlaybookStep[]
): LLMStep[] {
  const stepMap = new Map(playbookSteps.map((s) => [s.step_id, s]));
  return llmSteps
    .filter((ls) => stepMap.has(ls.step_id))
    .map((ls) => {
      const pb = stepMap.get(ls.step_id)!;
      return {
        step_id: ls.step_id,
        instruction: pb.instruction ?? ls.instruction,
        check: pb.check ?? ls.check,
      };
    });
}
