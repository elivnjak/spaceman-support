import { MANIFEST_DEFAULTS } from "@/lib/intent/defaults";
import { getIntentManifest } from "@/lib/intent/loader";

export const CONFIDENCE_CONFIG = {
  ...MANIFEST_DEFAULTS.confidence,
  /** Min similarity for RAG chunk inclusion; 0.25 keeps spec/electrical chunks that sit just below 0.3. */
  minChunkScore: MANIFEST_DEFAULTS.confidence.minChunkScore,
  /** When confidence below this or labelGap below visionLabelGapThreshold, run vision tie-breaker. */
  visionTieBreakerThreshold: MANIFEST_DEFAULTS.confidence.visionTieBreakerThreshold,
  /** When LLM returns "unknown", override to top label only if both conditions hold. */
  imageOverrideMinScore: MANIFEST_DEFAULTS.confidence.imageOverrideMinScore,
  /** Abstain when classifier confidence is below this and evidence is weak. */
  minFinalConfidence: MANIFEST_DEFAULTS.confidence.minFinalConfidence,
  /** Minimum top text chunk similarity required for confident text-grounded answer. */
  minTextChunkSimilarityForConfident:
    MANIFEST_DEFAULTS.confidence.minTextChunkSimilarityForConfident,
} as const;

export const RETRIEVAL_CONFIG = {
  ...MANIFEST_DEFAULTS.retrieval,
  /** When machine model is set, reserve this many slots for chunks from machine-matched documents. */
  textMachineMatchedReserve: MANIFEST_DEFAULTS.retrieval.textMachineMatchedReserve,
  /** Include labels whose score is within this delta of top score (catches near-ties). */
  candidateScoreMargin: MANIFEST_DEFAULTS.retrieval.candidateScoreMargin,
  /** Hybrid retrieval: weight applied to PostgreSQL FTS rank in text chunk ordering. */
  textKeywordRankWeight: MANIFEST_DEFAULTS.retrieval.textKeywordRankWeight,
  /** Small bonus for direct literal keyword match in chunk text. */
  textExactMatchBoost: MANIFEST_DEFAULTS.retrieval.textExactMatchBoost,
} as const;

export const EMBEDDING_CONFIG = {
  openaiTextModel: "text-embedding-3-small",
  openaiTextDimensions: 1536,
  clipDimensions: 512,
} as const;

export const LLM_CONFIG = {
  classificationModel: MANIFEST_DEFAULTS.models.classificationModel,
  generationModel: MANIFEST_DEFAULTS.models.generationModel,
  diagnosticPlannerModel: MANIFEST_DEFAULTS.models.diagnosticPlannerModel,
} as const;

export const DIAGNOSTIC_CONFIG = {
  /** Safety cap: only escalate for turn count if this is exceeded (allows long diagnostics until resolve/escalate). */
  maxTurns: MANIFEST_DEFAULTS.escalation.maxSessionTurns,
  maxRequestsPerTurn: MANIFEST_DEFAULTS.escalation.maxRequestsPerTurn,
  recentMessagesWindow: MANIFEST_DEFAULTS.escalation.recentMessagesWindow,
  stallTurnsWithoutNewEvidence:
    MANIFEST_DEFAULTS.escalation.stallTurnsWithoutNewEvidence,
  requiredEvidenceTurnsBeforeEscalation:
    MANIFEST_DEFAULTS.escalation.requiredEvidenceTurnsBeforeEscalation,
  consecutiveSkipsBeforeEscalationOffer:
    MANIFEST_DEFAULTS.escalation.consecutiveSkipsBeforeOffer,
} as const;

export const TRIAGE_CONFIG = {
  autoSelectThreshold: MANIFEST_DEFAULTS.escalation.triageAutoSelectThreshold,
  confirmThreshold: MANIFEST_DEFAULTS.escalation.triageConfirmThreshold,
  maxRounds: MANIFEST_DEFAULTS.escalation.triageMaxRounds,
} as const;

export const INGESTION_CONFIG = {
  visionModel: MANIFEST_DEFAULTS.models.visionModel,
  /** Min score from page heuristic (0–1) to trigger vision extraction for that page. */
  tablePageThreshold: 0.6,
  /** Skip vision entirely for PDFs exceeding this page count. */
  maxPagesForVision: 50,
  /** Enable numeric verification of vision output against deterministic text. */
  verifyNumerics: true,
} as const;

export const HTML_INGESTION_CONFIG = {
  /** Max informational images to process per page. */
  maxImages: 10,
  /** Minimum pixel dimension to consider an image (icons/spacers smaller than this are skipped). */
  minImageDimension: 150,
  /** Model for vision classification/description. */
  imageDescriptionModel: MANIFEST_DEFAULTS.models.visionModel,
  /** Max time (ms) to wait for JS-rendered page to settle. */
  jsRenderTimeout: 30_000,
} as const;

export async function getConfidenceConfig() {
  return (await getIntentManifest()).confidence;
}

export async function getRetrievalConfig() {
  return (await getIntentManifest()).retrieval;
}

export async function getLlmConfig() {
  const manifest = await getIntentManifest();
  return {
    classificationModel: manifest.models.classificationModel,
    generationModel: manifest.models.generationModel,
    diagnosticPlannerModel: manifest.models.diagnosticPlannerModel,
    triageModel: manifest.models.triageModel,
    visionModel: manifest.models.visionModel,
  };
}

export async function getDiagnosticConfig() {
  const escalation = (await getIntentManifest()).escalation;
  return {
    maxTurns: escalation.maxSessionTurns,
    maxRequestsPerTurn: escalation.maxRequestsPerTurn,
    recentMessagesWindow: escalation.recentMessagesWindow,
    stallTurnsWithoutNewEvidence: escalation.stallTurnsWithoutNewEvidence,
    requiredEvidenceTurnsBeforeEscalation:
      escalation.requiredEvidenceTurnsBeforeEscalation,
    consecutiveSkipsBeforeEscalationOffer: escalation.consecutiveSkipsBeforeOffer,
  };
}

export async function getTriageConfig() {
  const escalation = (await getIntentManifest()).escalation;
  return {
    autoSelectThreshold: escalation.triageAutoSelectThreshold,
    confirmThreshold: escalation.triageConfirmThreshold,
    maxRounds: escalation.triageMaxRounds,
  };
}
