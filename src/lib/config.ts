function getNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const CONFIDENCE_CONFIG = {
  topM: 3,
  highThreshold: 0.4,
  lowThreshold: 0.2,
  labelGapMinimum: 0.05,
  /** Min similarity for RAG chunk inclusion; 0.25 keeps spec/electrical chunks that sit just below 0.3. */
  minChunkScore: 0.25,
  unknownThreshold: 0.15,
  /** When confidence below this or labelGap below visionLabelGapThreshold, run GPT-4o vision tie-breaker. */
  visionTieBreakerThreshold: 0.4,
  visionLabelGapThreshold: 0.08,
  /** When LLM returns "unknown", override to top label only if both conditions hold. */
  imageOverrideMinScore: 0.45,
  imageOverrideMinGap: 0.1,
  /** Abstain when classifier confidence is below this and evidence is weak. */
  minFinalConfidence: 0.55,
  /** Minimum top text chunk similarity required for confident text-grounded answer. */
  minTextChunkSimilarityForConfident: 0.35,
} as const;

export const RETRIEVAL_CONFIG = {
  imageTopK: 5,
  textTopN: 8,
  /** When machine model is set, reserve this many slots for chunks from machine-matched documents. */
  textMachineMatchedReserve: 4,
  candidateLabelsCount: 3,
  /** Include labels whose score is within this delta of top score (catches near-ties). */
  candidateScoreMargin: 0.05,
  /** Hybrid retrieval: weight applied to PostgreSQL FTS rank in text chunk ordering. */
  textKeywordRankWeight: getNumberEnv("RETRIEVAL_TEXT_KEYWORD_RANK_WEIGHT", 0.4),
  /** Small bonus for direct literal keyword match in chunk text. */
  textExactMatchBoost: getNumberEnv("RETRIEVAL_TEXT_EXACT_MATCH_BOOST", 0.2),
} as const;

export const EMBEDDING_CONFIG = {
  openaiTextModel: "text-embedding-3-small",
  openaiTextDimensions: 1536,
  clipDimensions: 512,
} as const;

export const LLM_CONFIG = {
  classificationModel: "gpt-4o",
  generationModel: "gpt-4o",
  diagnosticPlannerModel: "gpt-4o",
} as const;

export const DIAGNOSTIC_CONFIG = {
  /** Safety cap: only escalate for turn count if this is exceeded (allows long diagnostics until resolve/escalate). */
  maxTurns: 50,
  maxRequestsPerTurn: 3,
  recentMessagesWindow: 5,
  stallTurnsWithoutNewEvidence: 2,
  requiredEvidenceTurnsBeforeEscalation: 4,
  consecutiveSkipsBeforeEscalationOffer: getNumberEnv("DIAGNOSTIC_CONSECUTIVE_SKIPS_BEFORE_ESCALATION_OFFER", 3),
} as const;

export const TRIAGE_CONFIG = {
  autoSelectThreshold: getNumberEnv("TRIAGE_AUTO_SELECT", 0.8),
  confirmThreshold: getNumberEnv("TRIAGE_CONFIRM_THRESHOLD", 0.7),
  maxRounds: getNumberEnv("TRIAGE_MAX_ROUNDS", 3),
} as const;

export const INGESTION_CONFIG = {
  visionModel: "gpt-4o",
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
  imageDescriptionModel: "gpt-4o",
  /** Max time (ms) to wait for JS-rendered page to settle. */
  jsRenderTimeout: 30_000,
} as const;
