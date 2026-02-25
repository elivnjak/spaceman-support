import type { FieldMeta, IntentManifest, IntentManifestMeta } from "./types";

function getNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function meta(
  label: string,
  description: string,
  impact: string,
  defaultValue: unknown,
  extra?: Pick<FieldMeta, "range" | "options">
): FieldMeta {
  return {
    label,
    description,
    impact,
    default: defaultValue,
    ...extra,
  };
}

export const MANIFEST_DEFAULTS: IntentManifest = {
  safety: {
    controlledVocabulary: [
      {
        id: "fire_or_smoke",
        terms: [
          "smoke",
          "burning smell",
          "burnt smell",
          "fire",
          "flame",
          "sparks",
          "arcing",
        ],
        reason: "Potential fire/electrical hazard detected",
        immediateEscalation: true,
      },
      {
        id: "electrical_hazard",
        terms: [
          "electrical shock",
          "got shocked",
          "live wire",
          "short circuit",
        ],
        reason: "Electrical hazard detected",
        immediateEscalation: true,
      },
      {
        id: "gas_or_refrigerant_leak",
        terms: [
          "gas leak",
          "refrigerant leak",
          "hissing leak",
          "chemical smell",
        ],
        reason: "Potential gas/refrigerant leak detected",
        immediateEscalation: true,
      },
    ],
    machineAgeThresholdYears: 5,
    requireNameplate: true,
    supportedBrand: "Spaceman",
  },
  confidence: {
    topM: 3,
    highThreshold: 0.4,
    lowThreshold: 0.2,
    labelGapMinimum: 0.05,
    minChunkScore: 0.25,
    unknownThreshold: 0.15,
    visionTieBreakerThreshold: 0.4,
    visionLabelGapThreshold: 0.08,
    imageOverrideMinScore: 0.45,
    imageOverrideMinGap: 0.1,
    minFinalConfidence: 0.55,
    minTextChunkSimilarityForConfident: 0.35,
    groundingDriftThreshold: 0.35,
    hypothesisResolutionMinConfidence: 0.72,
    hypothesisResolutionMinGap: 0.12,
    hypothesisMinEvidenceCoverage: 0.75,
  },
  escalation: {
    maxSessionTurns: 50,
    maxRequestsPerTurn: 3,
    recentMessagesWindow: 5,
    stallTurnsWithoutNewEvidence: 2,
    requiredEvidenceTurnsBeforeEscalation: 4,
    consecutiveSkipsBeforeOffer: getNumberEnv(
      "DIAGNOSTIC_CONSECUTIVE_SKIPS_BEFORE_ESCALATION_OFFER",
      3
    ),
    evidenceRatioMinimum: 0.6,
    triageMaxRounds: getNumberEnv("TRIAGE_MAX_ROUNDS", 3),
    triageAutoSelectThreshold: getNumberEnv("TRIAGE_AUTO_SELECT", 0.8),
    triageConfirmThreshold: getNumberEnv("TRIAGE_CONFIRM_THRESHOLD", 0.7),
  },
  retrieval: {
    imageTopK: 5,
    textTopN: 8,
    textMachineMatchedReserve: 4,
    candidateLabelsCount: 3,
    candidateScoreMargin: 0.05,
    textKeywordRankWeight: getNumberEnv(
      "RETRIEVAL_TEXT_KEYWORD_RANK_WEIGHT",
      0.4
    ),
    textExactMatchBoost: getNumberEnv("RETRIEVAL_TEXT_EXACT_MATCH_BOOST", 0.2),
  },
  communication: {
    tone: "empathetic",
    citationPolicy: "always",
    groundingStrictness: "strict",
    escalationTone:
      "For safety, we're escalating this to a technician immediately. Please stop troubleshooting and keep the machine in a safe state.",
    verificationQuestion: "Did that fix the issue?",
  },
  models: {
    classificationModel: "gpt-4o",
    generationModel: "gpt-4o",
    diagnosticPlannerModel: "gpt-4o",
    triageModel: "gpt-4o",
    visionModel: "gpt-4o",
  },
  frustrationHandling: {
    detectionPatterns: [
      {
        id: "talk_to_human",
        pattern: "\\b(talk to (a )?(person|human|agent|technician|support))\\b",
        description: "User explicitly asks to speak with a human.",
      },
      {
        id: "connect_or_escalate",
        pattern:
          "\\b(connect me|escalat(e|ion)|real person|human support)\\b",
        description: "User asks to be connected or escalated.",
      },
      {
        id: "frustration_phrase",
        pattern:
          "\\b(this isn't helping|not helping|this is not helping|frustrat(ed|ing))\\b",
        description: "User indicates the bot is not helping.",
      },
    ],
    alternatePathsBeforeEscalation: 1,
    escalationIntentMessage:
      "I understand this is frustrating. I can connect you with a technician now.",
    empathyAcknowledgment: true,
  },
};

const d = MANIFEST_DEFAULTS;

export const MANIFEST_META: IntentManifestMeta = {
  safety: {
    _domain: {
      label: "Safety",
      description:
        "Controls safety guardrails and hard-stop conditions where technician escalation is preferred.",
    },
    controlledVocabulary: meta(
      "Controlled safety vocabulary",
      "Terms that trigger immediate safety escalation before regular diagnostics continue.",
      "Adding broader terms escalates more conversations quickly. Narrowing terms reduces false escalations but can miss hazardous situations.",
      d.safety.controlledVocabulary
    ),
    machineAgeThresholdYears: meta(
      "Machine age threshold (years)",
      "If the detected machine age exceeds this threshold, the chat escalates to a technician.",
      "Lower values escalate more older machines. Higher values keep older machines in self-service longer.",
      d.safety.machineAgeThresholdYears,
      { range: { min: 1, max: 20, step: 1 } }
    ),
    requireNameplate: meta(
      "Require nameplate",
      "Whether a readable nameplate photo is mandatory before diagnostics proceed.",
      "Enabled increases model certainty and supportability. Disabled reduces friction but can reduce diagnostic accuracy.",
      d.safety.requireNameplate
    ),
    supportedBrand: meta(
      "Supported brand",
      "Brand name used to decide if a machine is supported.",
      "Changing this widens or narrows which machines are accepted into self-service diagnostics.",
      d.safety.supportedBrand
    ),
  },
  confidence: {
    _domain: {
      label: "Confidence",
      description:
        "Controls confidence thresholds, abstention behavior, and diagnosis resolution criteria.",
    },
    topM: meta(
      "Top image matches to average",
      "Number of top image matches used when aggregating label similarity.",
      "Higher values smooth noisy results; lower values make results react faster to top matches.",
      d.confidence.topM,
      { range: { min: 1, max: 10, step: 1 } }
    ),
    highThreshold: meta(
      "High confidence threshold",
      "Score considered strongly confident for image/classification logic.",
      "Raising this makes the system more conservative about claiming high confidence.",
      d.confidence.highThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    lowThreshold: meta(
      "Low confidence threshold",
      "Score below which predictions are treated as weak confidence.",
      "Raising this increases caution and follow-up prompts. Lowering this allows more automatic decisions.",
      d.confidence.lowThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    labelGapMinimum: meta(
      "Minimum label gap",
      "Minimum score gap between top and second label to consider the winner clearly separated.",
      "Higher gap reduces near-tie auto-selection. Lower gap allows more auto selection in ambiguous cases.",
      d.confidence.labelGapMinimum,
      { range: { min: 0, max: 0.5, step: 0.01 } }
    ),
    minChunkScore: meta(
      "Minimum text chunk similarity",
      "Lowest chunk similarity allowed into text retrieval grounding.",
      "Higher values increase precision but can miss relevant chunks. Lower values increase recall but can add noise.",
      d.confidence.minChunkScore,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    unknownThreshold: meta(
      "Unknown threshold",
      "If top image confidence is below this, the system prefers returning unknown over guessing.",
      "Lowering this increases coverage with more risk. Raising this increases abstention and safety.",
      d.confidence.unknownThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    visionTieBreakerThreshold: meta(
      "Vision tie-break threshold",
      "If confidence is below this, a vision tie-breaker is triggered.",
      "Lower values trigger tie-break less often (faster, cheaper). Higher values trigger it more often (more careful).",
      d.confidence.visionTieBreakerThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    visionLabelGapThreshold: meta(
      "Vision tie-break label-gap threshold",
      "If top-two labels are closer than this, a vision tie-breaker is triggered.",
      "Higher values trigger tie-break on more near-ties.",
      d.confidence.visionLabelGapThreshold,
      { range: { min: 0, max: 0.5, step: 0.01 } }
    ),
    imageOverrideMinScore: meta(
      "Image override minimum score",
      "Minimum score needed before overriding an LLM unknown with the top image label.",
      "Higher values make overrides rarer and safer.",
      d.confidence.imageOverrideMinScore,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    imageOverrideMinGap: meta(
      "Image override minimum gap",
      "Minimum score gap needed before overriding LLM unknown with top image label.",
      "Higher values require clearer visual separation between labels.",
      d.confidence.imageOverrideMinGap,
      { range: { min: 0, max: 0.5, step: 0.01 } }
    ),
    minFinalConfidence: meta(
      "Minimum final confidence",
      "Minimum confidence needed before returning a confident final diagnosis.",
      "Higher values increase abstention and escalation; lower values increase autonomous conclusions.",
      d.confidence.minFinalConfidence,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    minTextChunkSimilarityForConfident: meta(
      "Min text similarity for confident answer",
      "Top text-chunk similarity required for documentation-grounded confidence.",
      "Higher values enforce stronger grounding before confident answers.",
      d.confidence.minTextChunkSimilarityForConfident,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    groundingDriftThreshold: meta(
      "Instruction drift threshold",
      "Token-overlap threshold used to detect if the LLM rewrote playbook instructions too much.",
      "Higher values flag drift more aggressively and enforce playbook text more often.",
      d.confidence.groundingDriftThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    hypothesisResolutionMinConfidence: meta(
      "Hypothesis min confidence for resolve",
      "Minimum top-hypothesis confidence required before auto-resolving.",
      "Raising this delays resolution and increases evidence collection.",
      d.confidence.hypothesisResolutionMinConfidence,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    hypothesisResolutionMinGap: meta(
      "Hypothesis min gap for resolve",
      "Minimum confidence gap between top and second hypothesis before auto-resolving.",
      "Higher values require clearer separation between candidate causes.",
      d.confidence.hypothesisResolutionMinGap,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    hypothesisMinEvidenceCoverage: meta(
      "Hypothesis min evidence coverage",
      "Minimum required-evidence coverage before hypothesis-based resolve is allowed.",
      "Higher values increase rigor and may increase escalation frequency.",
      d.confidence.hypothesisMinEvidenceCoverage,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
  },
  escalation: {
    _domain: {
      label: "Escalation",
      description:
        "Controls when diagnostics stop and a technician handoff is triggered.",
    },
    maxSessionTurns: meta(
      "Maximum session turns",
      "Hard cap on diagnostic turns before escalation.",
      "Lower values escalate faster. Higher values allow longer autonomous troubleshooting.",
      d.escalation.maxSessionTurns,
      { range: { min: 1, max: 200, step: 1 } }
    ),
    maxRequestsPerTurn: meta(
      "Maximum requests per turn",
      "Upper bound for how many requests the planner can propose in one response.",
      "Higher values speed data collection but increase cognitive load per user turn.",
      d.escalation.maxRequestsPerTurn,
      { range: { min: 1, max: 10, step: 1 } }
    ),
    recentMessagesWindow: meta(
      "Recent message window",
      "How many recent messages are sent into the planner context.",
      "Higher values improve continuity but increase token cost.",
      d.escalation.recentMessagesWindow,
      { range: { min: 1, max: 20, step: 1 } }
    ),
    stallTurnsWithoutNewEvidence: meta(
      "Stall turns before escalation",
      "Consecutive turns without new evidence before escalation is triggered.",
      "Lower values escalate faster when progress stalls.",
      d.escalation.stallTurnsWithoutNewEvidence,
      { range: { min: 1, max: 20, step: 1 } }
    ),
    requiredEvidenceTurnsBeforeEscalation: meta(
      "Turns before evidence-quality escalation",
      "Minimum turns before escalating due to insufficient required evidence quality.",
      "Lower values escalate early when evidence is weak.",
      d.escalation.requiredEvidenceTurnsBeforeEscalation,
      { range: { min: 1, max: 50, step: 1 } }
    ),
    consecutiveSkipsBeforeOffer: meta(
      "Skips before escalation offer",
      "How many consecutive skipped answers trigger an explicit escalation offer.",
      "Lower values offer technician handoff sooner for blocked users.",
      d.escalation.consecutiveSkipsBeforeOffer,
      { range: { min: 1, max: 20, step: 1 } }
    ),
    evidenceRatioMinimum: meta(
      "Minimum required-evidence ratio",
      "Required evidence ratio used in post-planner evidence-quality escalation checks.",
      "Higher values require more complete evidence before staying in self-service mode.",
      d.escalation.evidenceRatioMinimum,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    triageMaxRounds: meta(
      "Max triage rounds",
      "Maximum clarification rounds while selecting the diagnostic playbook.",
      "Lower values escalate from triage sooner; higher values ask more disambiguation questions.",
      d.escalation.triageMaxRounds,
      { range: { min: 1, max: 10, step: 1 } }
    ),
    triageAutoSelectThreshold: meta(
      "Triage auto-select threshold",
      "Confidence threshold above which triage auto-selects a playbook.",
      "Higher values reduce incorrect auto-selection but ask more follow-up questions.",
      d.escalation.triageAutoSelectThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    triageConfirmThreshold: meta(
      "Triage confirm threshold",
      "Confidence threshold used to force a selection at max triage rounds.",
      "Higher values are stricter and can increase escalation when uncertain.",
      d.escalation.triageConfirmThreshold,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
  },
  retrieval: {
    _domain: {
      label: "Retrieval",
      description:
        "Controls image/text retrieval breadth and the hybrid ranking blend.",
    },
    imageTopK: meta(
      "Image Top-K",
      "How many similar reference images are retrieved for visual matching.",
      "Higher values improve recall but increase noise and compute.",
      d.retrieval.imageTopK,
      { range: { min: 1, max: 20, step: 1 } }
    ),
    textTopN: meta(
      "Text Top-N",
      "How many text chunks are retrieved for grounding.",
      "Higher values increase context and token cost.",
      d.retrieval.textTopN,
      { range: { min: 1, max: 30, step: 1 } }
    ),
    textMachineMatchedReserve: meta(
      "Machine-matched reserve",
      "Chunk slots reserved for machine-model-matched documents.",
      "Higher values prioritize machine-specific docs over general docs.",
      d.retrieval.textMachineMatchedReserve,
      { range: { min: 0, max: 20, step: 1 } }
    ),
    candidateLabelsCount: meta(
      "Candidate label count",
      "Base number of label candidates passed to classification.",
      "Higher values widen candidate exploration but can increase ambiguity.",
      d.retrieval.candidateLabelsCount,
      { range: { min: 1, max: 10, step: 1 } }
    ),
    candidateScoreMargin: meta(
      "Candidate score margin",
      "Extra labels included when they are near the top score by this margin.",
      "Higher margins include more near-ties; lower margins focus on strongest labels.",
      d.retrieval.candidateScoreMargin,
      { range: { min: 0, max: 0.5, step: 0.01 } }
    ),
    textKeywordRankWeight: meta(
      "Keyword rank weight",
      "Weight applied to PostgreSQL full-text rank in hybrid text retrieval.",
      "Higher values prioritize literal keyword matches over semantic similarity.",
      d.retrieval.textKeywordRankWeight,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
    textExactMatchBoost: meta(
      "Exact-match boost",
      "Additional score boost for direct literal keyword matches in chunk text.",
      "Higher values favor exact term matches and can improve precision for model numbers/error codes.",
      d.retrieval.textExactMatchBoost,
      { range: { min: 0, max: 1, step: 0.01 } }
    ),
  },
  communication: {
    _domain: {
      label: "Communication",
      description:
        "Controls tone, citation behavior, and grounding strictness in assistant responses.",
    },
    tone: meta(
      "Tone",
      "Primary conversational tone used for assistant prompts.",
      "Changing tone affects perceived helpfulness and formality.",
      d.communication.tone,
      { options: ["professional", "friendly", "empathetic"] }
    ),
    citationPolicy: meta(
      "Citation policy",
      "How strictly responses should include document citations for factual claims.",
      "Stricter citation improves traceability but can make responses denser.",
      d.communication.citationPolicy,
      { options: ["always", "admin_only", "never"] }
    ),
    groundingStrictness: meta(
      "Grounding strictness",
      "How strict the assistant should be about only stating documented facts.",
      "Stricter grounding reduces hallucination risk but may reduce helpfulness when docs are sparse.",
      d.communication.groundingStrictness,
      { options: ["strict", "moderate", "relaxed"] }
    ),
    escalationTone: meta(
      "Escalation safety message",
      "Default user-facing message used for immediate safety escalation.",
      "Editing this changes how urgent/specific safety escalation messaging feels.",
      d.communication.escalationTone
    ),
    verificationQuestion: meta(
      "Resolution verification question",
      "Question asked after presenting a resolution to confirm if it worked.",
      "Changing this can improve or reduce completion tracking clarity.",
      d.communication.verificationQuestion
    ),
  },
  models: {
    _domain: {
      label: "Models",
      description:
        "Controls which model is used for each pipeline stage and its cost-quality profile.",
    },
    classificationModel: meta(
      "Classification model",
      "Model used for initial issue classification and playbook triage selection.",
      "Cheaper models reduce cost but can increase misclassification risk at session start.",
      d.models.classificationModel
    ),
    generationModel: meta(
      "Generation model",
      "Model used for one-shot diagnosis and step generation in analysis flow.",
      "More capable models improve explanation quality but increase cost.",
      d.models.generationModel
    ),
    diagnosticPlannerModel: meta(
      "Diagnostic planner model",
      "Model used in multi-turn planning and evidence-to-hypothesis reasoning.",
      "This model drives most runtime cost during chat diagnostics.",
      d.models.diagnosticPlannerModel
    ),
    triageModel: meta(
      "Triage model",
      "Model used specifically in triage flow when choosing playbooks.",
      "A stronger triage model reduces wrong-playbook starts.",
      d.models.triageModel
    ),
    visionModel: meta(
      "Vision model",
      "Model used for vision extraction tasks in ingestion/nameplate workflows.",
      "Stronger vision models improve OCR and visual understanding but cost more.",
      d.models.visionModel
    ),
  },
  frustrationHandling: {
    _domain: {
      label: "Frustration Handling",
      description:
        "Controls how user frustration/escalation intent is detected and how quickly human handoff occurs.",
    },
    detectionPatterns: meta(
      "Frustration detection patterns",
      "Regex patterns used to detect escalation intent and frustration language.",
      "Broader patterns detect more frustrated users but can cause false positives.",
      d.frustrationHandling.detectionPatterns
    ),
    alternatePathsBeforeEscalation: meta(
      "Alternate paths before escalation",
      "How many alternate troubleshooting attempts to make before honoring escalation intent.",
      "Lower values prioritize user preference for a human; higher values try harder to self-resolve first.",
      d.frustrationHandling.alternatePathsBeforeEscalation,
      { range: { min: 0, max: 5, step: 1 } }
    ),
    escalationIntentMessage: meta(
      "Escalation intent message",
      "Default message shown when the user asks for human escalation.",
      "Changing this affects clarity and empathy when handing off.",
      d.frustrationHandling.escalationIntentMessage
    ),
    empathyAcknowledgment: meta(
      "Empathy acknowledgment",
      "Whether to explicitly acknowledge frustration before continuing or escalating.",
      "Turning this off makes responses shorter but can feel less supportive.",
      d.frustrationHandling.empathyAcknowledgment
    ),
  },
};
