import { MANIFEST_DEFAULTS } from "@/lib/intent/defaults";

export type PlaybookStep = {
  step_id: string;
  title?: string;
  instruction?: string;
  check?: string;
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

function normaliseAlias(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStepAliasMap(playbookSteps: PlaybookStep[]): Map<string, string> {
  const aliasCandidates = new Map<string, Set<string>>();
  for (const step of playbookSteps) {
    const aliases = [step.step_id, step.title, step.instruction, step.check]
      .map((value) => normaliseAlias(value))
      .filter(Boolean);
    for (const alias of aliases) {
      const existing = aliasCandidates.get(alias) ?? new Set<string>();
      existing.add(step.step_id);
      aliasCandidates.set(alias, existing);
    }
  }

  const aliasMap = new Map<string, string>();
  for (const [alias, stepIds] of aliasCandidates.entries()) {
    if (stepIds.size === 1) {
      aliasMap.set(alias, [...stepIds][0]!);
    }
  }
  return aliasMap;
}

function resolveStepIdFromAliases(
  step: LLMStep,
  aliasMap: Map<string, string>
): string | null {
  const aliases = [step.step_id, step.instruction, step.check]
    .map((value) => normaliseAlias(value))
    .filter(Boolean);

  for (const alias of aliases) {
    const remappedStepId = aliasMap.get(alias);
    if (remappedStepId) {
      return remappedStepId;
    }
  }

  return null;
}

function remapLlMSteps(llmSteps: LLMStep[], playbookSteps: PlaybookStep[]): LLMStep[] {
  const aliasMap = buildStepAliasMap(playbookSteps);
  return llmSteps.map((step) => {
    const remappedStepId = resolveStepIdFromAliases(step, aliasMap);
    if (!remappedStepId) return step;
    return {
      ...step,
      step_id: remappedStepId,
    };
  });
}

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

const INSTRUCTION_DRIFT_THRESHOLD =
  MANIFEST_DEFAULTS.confidence.groundingDriftThreshold;

export function validateGrounding(
  llmSteps: LLMStep[],
  playbookSteps: PlaybookStep[]
): ValidationResult {
  const normalizedLlMSteps = remapLlMSteps(llmSteps, playbookSteps);
  const stepMap = new Map(playbookSteps.map((s) => [s.step_id, s]));
  const invalidStepIds: string[] = [];
  const driftedStepIds: string[] = [];

  for (const ls of normalizedLlMSteps) {
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
  const normalizedLlMSteps = remapLlMSteps(llmSteps, playbookSteps);
  const stepMap = new Map(playbookSteps.map((s) => [s.step_id, s]));
  return normalizedLlMSteps
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
