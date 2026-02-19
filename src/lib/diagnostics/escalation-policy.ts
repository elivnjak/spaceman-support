import type { EscalationTriggerItem } from "@/lib/pipeline/diagnostic-planner";

type EvidenceSummary = {
  ratio: number;
  requiredCount: number;
  collectedRequired: number;
};

type PrePlannerInput = {
  userMessage: string;
  triggers?: EscalationTriggerItem[] | null;
  turnCount: number;
  maxTurns: number;
  evidence: EvidenceSummary;
};

type PostPlannerInput = {
  turnCount: number;
  evidence: EvidenceSummary;
  plannerPhase: "gathering_info" | "diagnosing" | "resolving" | "resolved_followup" | "escalated";
  plannerRequestsCount: number;
  newEvidenceCount: number;
  lastEvidenceTurn: number;
  stallTurnsWithoutNewEvidence: number;
  requiredEvidenceTurnsBeforeEscalation: number;
};

export type EscalationDecision = {
  source:
    | "safety_controlled_vocabulary"
    | "playbook_trigger"
    | "turn_limit"
    | "evidence_quality"
    | "evidence_stall";
  escalationReason: string;
  assistantMessage: string;
};

const SAFETY_CONTROLLED_VOCAB: Array<{
  id: string;
  terms: string[];
  reason: string;
}> = [
  {
    id: "fire_or_smoke",
    terms: ["smoke", "burning smell", "burnt smell", "fire", "flame", "sparks", "arcing"],
    reason: "Potential fire/electrical hazard detected",
  },
  {
    id: "electrical_hazard",
    terms: ["electrical shock", "got shocked", "live wire", "short circuit"],
    reason: "Electrical hazard detected",
  },
  {
    id: "gas_or_refrigerant_leak",
    terms: ["gas leak", "refrigerant leak", "hissing leak", "chemical smell"],
    reason: "Potential gas/refrigerant leak detected",
  },
];

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(message: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "i");
  return re.test(message);
}

function detectControlledSafetySignal(userMessage: string): EscalationDecision | null {
  const normalized = normalizeText(userMessage);
  for (const group of SAFETY_CONTROLLED_VOCAB) {
    for (const term of group.terms) {
      if (containsTerm(normalized, term)) {
        return {
          source: "safety_controlled_vocabulary",
          escalationReason: `${group.reason}: ${term}.`,
          assistantMessage:
            "For safety, we're escalating this to a technician immediately. Please stop troubleshooting and keep the machine in a safe state.",
        };
      }
    }
  }
  return null;
}

function detectPlaybookTrigger(
  userMessage: string,
  triggers?: EscalationTriggerItem[] | null
): EscalationDecision | null {
  if (!triggers?.length) return null;
  const normalized = normalizeText(userMessage);
  const tokenSet = new Set(normalized.split(" ").filter((t) => t.length >= 3));

  for (const trigger of triggers) {
    const triggerNorm = normalizeText(trigger.trigger);
    if (!triggerNorm) continue;
    if (containsTerm(normalized, triggerNorm)) {
      return {
        source: "playbook_trigger",
        escalationReason: trigger.reason || `Playbook trigger matched: ${trigger.trigger}`,
        assistantMessage: `For your safety we're connecting you with a technician. ${trigger.reason || "Please describe what you're seeing to support."}`,
      };
    }

    // Controlled-vocabulary style token matching (avoids brittle raw substring checks).
    const triggerTokens = triggerNorm.split(" ").filter((t) => t.length >= 3);
    if (triggerTokens.length > 0 && triggerTokens.every((t) => tokenSet.has(t))) {
      return {
        source: "playbook_trigger",
        escalationReason: trigger.reason || `Playbook trigger token match: ${trigger.trigger}`,
        assistantMessage: `For your safety we're connecting you with a technician. ${trigger.reason || "Please describe what you're seeing to support."}`,
      };
    }
  }
  return null;
}

export function evaluatePrePlannerEscalation(input: PrePlannerInput): EscalationDecision | null {
  const safety = detectControlledSafetySignal(input.userMessage);
  if (safety) return safety;

  const playbook = detectPlaybookTrigger(input.userMessage, input.triggers);
  if (playbook) return playbook;

  if (input.turnCount > input.maxTurns) {
    return {
      source: "turn_limit",
      escalationReason: "Session length limit reached",
      assistantMessage:
        "This session has reached its maximum length. Connecting you with a technician who can help further.",
    };
  }

  return null;
}

export function evaluatePostPlannerEscalation(input: PostPlannerInput): EscalationDecision | null {
  const noNextStep =
    (input.plannerPhase === "diagnosing" || input.plannerPhase === "gathering_info") &&
    input.plannerRequestsCount === 0;
  const evidenceInsufficient = input.evidence.requiredCount > 0 && input.evidence.ratio < 0.6;
  if (
    noNextStep &&
    evidenceInsufficient &&
    input.turnCount >= input.requiredEvidenceTurnsBeforeEscalation
  ) {
    return {
      source: "evidence_quality",
      escalationReason:
        "Insufficient required evidence quality to continue safely without technician review.",
      assistantMessage:
        "We weren't able to gather enough reliable checks to continue safely. I'm connecting you with a technician who can help further.",
    };
  }

  const stalled =
    input.turnCount >= 2 &&
    input.newEvidenceCount === 0 &&
    input.turnCount - input.lastEvidenceTurn >= input.stallTurnsWithoutNewEvidence;
  if (stalled) {
    return {
      source: "evidence_stall",
      escalationReason: "No new evidence for several turns; connecting you with support.",
      assistantMessage: "No new evidence for several turns; connecting you with support.",
    };
  }

  return null;
}
