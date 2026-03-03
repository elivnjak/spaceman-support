import { z } from "zod";

const boundedUnitNumber = z.number().min(0).max(1);

export const safetyVocabularyItemSchema = z.object({
  id: z.string().min(1),
  terms: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
  immediateEscalation: z.boolean(),
});

export const intentManifestSchema = z.object({
  safety: z.object({
    controlledVocabulary: z.array(safetyVocabularyItemSchema).min(1),
    machineAgeThresholdYears: z.number().int().min(1).max(50),
    requireNameplate: z.boolean(),
    supportedBrand: z.string().min(1),
  }),
  confidence: z.object({
    minChunkScore: boundedUnitNumber,
    minFinalConfidence: boundedUnitNumber,
    minTextChunkSimilarityForConfident: boundedUnitNumber,
    groundingDriftThreshold: boundedUnitNumber,
    hypothesisResolutionMinConfidence: boundedUnitNumber,
    hypothesisResolutionMinGap: boundedUnitNumber,
    hypothesisMinEvidenceCoverage: boundedUnitNumber,
  }),
  escalation: z.object({
    maxSessionTurns: z.number().int().min(1).max(200),
    maxRequestsPerTurn: z.number().int().min(1).max(10),
    recentMessagesWindow: z.number().int().min(1).max(20),
    stallTurnsWithoutNewEvidence: z.number().int().min(1).max(20),
    requiredEvidenceTurnsBeforeEscalation: z.number().int().min(1).max(50),
    consecutiveSkipsBeforeOffer: z.number().int().min(1).max(20),
    evidenceRatioMinimum: boundedUnitNumber,
    triageMaxRounds: z.number().int().min(1).max(10),
    triageAutoSelectThreshold: boundedUnitNumber,
    triageConfirmThreshold: boundedUnitNumber,
  }),
  retrieval: z.object({
    textTopN: z.number().int().min(1).max(30),
    textMachineMatchedReserve: z.number().int().min(0).max(20),
    textKeywordRankWeight: boundedUnitNumber,
    textExactMatchBoost: boundedUnitNumber,
  }),
  communication: z.object({
    tone: z.enum(["professional", "friendly", "empathetic"]),
    citationPolicy: z.enum(["always", "admin_only", "never"]),
    groundingStrictness: z.enum(["strict", "moderate", "relaxed"]),
    escalationTone: z.string().min(1),
    telegramEscalationNotificationText: z.string().min(1),
    noModelNumberEscalationMessage: z.string().min(1),
    technicalDifficultiesEscalationMessage: z.string().min(1),
    verificationQuestion: z.string().min(1),
  }),
  models: z.object({
    classificationModel: z.string().min(1),
    generationModel: z.string().min(1),
    diagnosticPlannerModel: z.string().min(1),
    triageModel: z.string().min(1),
    visionModel: z.string().min(1),
  }),
  frustrationHandling: z.object({
    detectionPatterns: z
      .array(
        z.object({
          id: z.string().min(1),
          pattern: z.string().min(1),
          description: z.string().min(1),
        })
      )
      .min(1),
    alternatePathsBeforeEscalation: z.number().int().min(0).max(5),
    escalationIntentMessage: z.string().min(1),
    empathyAcknowledgment: z.boolean(),
    sentimentClassifierEnabled: z.boolean(),
    frustrationEscalationThreshold: z.enum(["moderate", "high"]),
    consecutiveFrustrationTurnsBeforeEscalation: z.number().int().min(1).max(5),
  }),
});

export type IntentManifest = z.infer<typeof intentManifestSchema>;
export const intentManifestOverrideSchema = intentManifestSchema.deepPartial();
export type IntentManifestOverride = z.infer<typeof intentManifestOverrideSchema>;

export type FieldMeta = {
  label: string;
  description: string;
  impact: string;
  range?: {
    min: number;
    max: number;
    step?: number;
  };
  options?: string[];
  default: unknown;
};

export type DomainMeta<T extends Record<string, unknown>> = {
  _domain: { label: string; description: string };
} & {
  [Field in keyof T]: FieldMeta;
};

export type IntentManifestMeta = {
  [Domain in keyof IntentManifest]: DomainMeta<IntentManifest[Domain]>;
};
