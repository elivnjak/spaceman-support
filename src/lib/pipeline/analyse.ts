import { db } from "@/lib/db";
import { labels, machineSpecs, playbooks } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { toCanonicalModel } from "@/lib/ingestion/extract-machine-model";
import { clipEmbedder } from "@/lib/embeddings/clip";
import { getConfiguredClipProvider } from "@/lib/embeddings/clip";
import { openaiTextEmbedder } from "@/lib/embeddings/openai-text";
import { getConfidenceConfig, getRetrievalConfig } from "@/lib/config";
import {
  searchReferenceImages,
  aggregateLabelScores,
  type ImageMatch,
} from "./image-retrieval";
import { searchDocChunks, type TextChunkMatch } from "./text-retrieval";
import {
  classifyLabel,
  classifyLabelWithVision,
  type ClassifyResult,
} from "./classify";
import {
  generateAnswerWithValidation,
  type GenerateResult,
} from "./generate";
import type { PlaybookStep } from "./validate-grounding";

export type AnalyseInput = {
  userText: string;
  imageBuffers: Buffer[];
  machineModel?: string;
  onStage?: (stage: AnalyseStage) => void;
};

export type AnalyseStage =
  | "analysing_photos"
  | "finding_similar"
  | "searching_manuals"
  | "generating_steps";

export type AnalyseResult = {
  predictedLabel: string;
  labelDisplayName: string;
  confidence: number;
  unknown: boolean;
  topMatches: { referenceImageId: string; labelId: string; similarity: number }[];
  retrievedChunks: { id: string; content: string; metadata?: unknown; similarity?: number }[];
  answer?: {
    diagnosis: string;
    steps: { step_id: string; instruction: string; check?: string }[];
    why: string;
    retakeTips?: string[];
    citations?: { chunkId: string; reason: string }[];
  };
  clarifyingQuestions?: string[];
  retakeTips?: string[];
  /** Logged for calibration; stored in support_sessions.result */
  similarityStats?: { topScore: number; secondScore: number; labelGap: number; top3Mean: number };
  onStage?: (stage: AnalyseStage) => void;
};

export async function runAnalysis(input: AnalyseInput): Promise<AnalyseResult> {
  const [confidenceConfig, retrievalConfig] = await Promise.all([
    getConfidenceConfig(),
    getRetrievalConfig(),
  ]);
  const { userText, imageBuffers, machineModel, onStage } = input;
  const hasImages = imageBuffers.length > 0;

  if (hasImages) onStage?.("analysing_photos");
  const imageEmbeddings: number[][] = [];
  for (const buf of imageBuffers) {
    const emb = await clipEmbedder.embed(buf);
    imageEmbeddings.push(emb);
  }

  if (hasImages) onStage?.("finding_similar");
  const allMatches: ImageMatch[] = [];
  const clipProvider = getConfiguredClipProvider();
  for (const emb of imageEmbeddings) {
    const matches = await searchReferenceImages(emb, undefined, clipProvider ?? undefined);
    allMatches.push(...matches);
  }
  const labelScores = aggregateLabelScores(allMatches, confidenceConfig.topM);
  const topScore = labelScores[0]?.score ?? 0;
  const secondScore = labelScores[1]?.score ?? 0;
  const labelGap = topScore - secondScore;
  const baseCount = retrievalConfig.candidateLabelsCount;
  const margin = retrievalConfig.candidateScoreMargin;
  const cutoff = topScore - margin;
  const allLabels = await db.select().from(labels);
  const candidateLabels = hasImages
    ? labelScores.filter((ls, i) => i < baseCount || ls.score >= cutoff)
    : allLabels.map((l) => ({ labelId: l.id, score: 0, matchCount: 0 }));

  const shouldBeUnknown =
    hasImages &&
    (topScore < confidenceConfig.unknownThreshold ||
      (topScore < confidenceConfig.lowThreshold &&
        labelGap < confidenceConfig.labelGapMinimum));

  if (shouldBeUnknown) {
    const earlyTop3Mean =
      labelScores.length > 0
        ? labelScores
            .slice(0, 3)
            .reduce((s, ls) => s + ls.score, 0) / Math.min(3, labelScores.length)
        : 0;
    return {
      predictedLabel: "unknown",
      labelDisplayName: "Unknown",
      confidence: topScore,
      unknown: true,
      topMatches: allMatches.slice(0, 5).map((m) => ({
        referenceImageId: m.referenceImageId,
        labelId: m.labelId,
        similarity: m.similarity,
      })),
      retrievedChunks: [],
      clarifyingQuestions: [
        "Can you describe the consistency (e.g. watery, icy, thick)?",
        "Could you upload another photo from a different angle?",
      ],
      retakeTips: [
        "Use better lighting",
        "Show the texture close-up",
        "Upload from a different angle",
      ],
      similarityStats: {
        topScore,
        secondScore,
        labelGap,
        top3Mean: earlyTop3Mean,
      },
    };
  }

  onStage?.("searching_manuals");
  const modelContext = machineModel ? ` machine model ${machineModel}` : "";
  const queryText = `${userText}${modelContext} ${candidateLabels.map((c) => c.labelId).join(" ")} troubleshooting steps checks causes`;
  const queryEmbedding = await openaiTextEmbedder.embed(queryText);
  const scopedLabelForRetrieval = candidateLabels[0]?.labelId;
  const textChunks = await searchDocChunks(
    queryEmbedding,
    undefined,
    machineModel,
    scopedLabelForRetrieval,
    userText
  );
  const chunkTitles = textChunks.map((c) => c.content.slice(0, 80));

  const candidateWithNames = candidateLabels.map((c) => {
    const l = allLabels.find((x) => x.id === c.labelId);
    return {
      labelId: c.labelId,
      displayName: l?.displayName ?? c.labelId,
      description: l?.description,
    };
  });

  const imageMatchSummary = hasImages
    ? candidateLabels.map((c) => `${c.labelId}: score ${c.score.toFixed(3)}`).join("; ")
    : "No images provided";

  let classifyResult: ClassifyResult = await classifyLabel({
    userText,
    imageMatchSummary,
    candidateLabels: candidateWithNames,
    chunkTitles,
    machineModel,
  });

  const needsVisionTieBreaker =
    classifyResult.confidence < confidenceConfig.visionTieBreakerThreshold ||
    labelGap < confidenceConfig.visionLabelGapThreshold;
  if (needsVisionTieBreaker && imageBuffers.length > 0) {
    const visionResult = await classifyLabelWithVision({
      userText,
      imageMatchSummary,
      candidateLabels: candidateWithNames,
      chunkTitles,
      machineModel,
      imageBuffers,
    });
    if (visionResult.confidence > classifyResult.confidence) {
      classifyResult = visionResult;
    }
  }

  const validLabelIds = new Set(candidateWithNames.map((c) => c.labelId));
  const rawFinal = classifyResult.finalLabel;
  const topChunkSimilarity = textChunks[0]?.similarity ?? 0;
  const evidenceBackedConfidence = Math.max(
    hasImages ? topScore : 0,
    Math.min(1, Math.max(0, topChunkSimilarity))
  );
  const calibratedConfidence = Math.min(
    classifyResult.confidence,
    evidenceBackedConfidence
  );
  const weakTextEvidence =
    textChunks.length === 0 ||
    topChunkSimilarity < confidenceConfig.minTextChunkSimilarityForConfident;
  const weakImageEvidence =
    !hasImages ||
    topScore < confidenceConfig.lowThreshold ||
    labelGap < confidenceConfig.labelGapMinimum;
  const abstainOnWeakEvidence =
    calibratedConfidence < confidenceConfig.minFinalConfidence &&
    weakTextEvidence &&
    weakImageEvidence;
  const isInvalidLabel =
    rawFinal === "unknown" ||
    calibratedConfidence < confidenceConfig.lowThreshold ||
    abstainOnWeakEvidence ||
    !validLabelIds.has(rawFinal);

  let finalLabel = isInvalidLabel ? "unknown" : rawFinal;
  const confidence = calibratedConfidence;

  const top3Mean =
    labelScores.length > 0
      ? labelScores
          .slice(0, 3)
          .reduce((s, ls) => s + ls.score, 0) / Math.min(3, labelScores.length)
      : 0;

  // Safety: do not force labels when LLM selected "unknown".

  if (finalLabel === "unknown") {
    return {
      predictedLabel: "unknown",
      labelDisplayName: "Unknown",
      confidence: classifyResult.confidence,
      unknown: true,
      topMatches: allMatches.slice(0, 5).map((m) => ({
        referenceImageId: m.referenceImageId,
        labelId: m.labelId,
        similarity: m.similarity,
      })),
      retrievedChunks: textChunks.map((c) => ({
        id: c.id,
        content: c.content,
        metadata: c.metadata,
        similarity: c.similarity,
      })),
      clarifyingQuestions: classifyResult.clarifyingQuestions,
      retakeTips: ["Retake with better lighting", "Try a different angle"],
      similarityStats: { topScore, secondScore, labelGap, top3Mean },
    };
  }

  const labelRow = allLabels.find((l) => l.id === finalLabel);
  const playbookRow = await db.query.playbooks.findFirst({
    where: eq(playbooks.labelId, finalLabel),
  });
  const lowerUserText = userText.toLowerCase();
  const hasPowerOffConfirmation =
    lowerUserText.includes("power off") ||
    lowerUserText.includes("powered off") ||
    lowerUserText.includes("turned off");
  const playbookSteps = ((playbookRow?.steps as PlaybookStep[]) ?? []).filter((s) => {
    const level = s.safetyLevel ?? "safe";
    if (level === "technician_only") return false;
    if (level === "caution" && !hasPowerOffConfirmation) return false;
    return true;
  });

  onStage?.("generating_steps");
  let machineSpecsRecord: Record<string, unknown> | undefined;
  if (machineModel) {
    const canonical = toCanonicalModel(machineModel) ?? machineModel;
    const withPrefix = canonical ? `SM-${canonical}` : null;
    const specRow = await db.query.machineSpecs.findFirst({
      where: withPrefix
        ? or(
            eq(machineSpecs.machineModel, canonical),
            eq(machineSpecs.machineModel, withPrefix)
          )
        : eq(machineSpecs.machineModel, canonical),
    });
    if (specRow?.specs && typeof specRow.specs === "object")
      machineSpecsRecord = specRow.specs as Record<string, unknown>;
  }
  let answer: GenerateResult | undefined;
  if (playbookSteps.length > 0) {
    answer = await generateAnswerWithValidation({
      finalLabel,
      labelDisplayName: labelRow?.displayName ?? finalLabel,
      playbookSteps,
      textChunks: textChunks.map((c) => ({
        id: c.id,
        content: c.content,
        metadata: c.metadata,
      })),
      userText,
      imageMatchesSummary: imageMatchSummary,
      machineModel,
      machineSpecs: machineSpecsRecord,
    });
  } else {
    answer = {
      diagnosis: "No playbook found for this label.",
      steps: [],
      why: "Add a playbook in Admin for this label.",
    };
  }

  return {
    predictedLabel: finalLabel,
    labelDisplayName: labelRow?.displayName ?? finalLabel,
    confidence,
    unknown: false,
    topMatches: allMatches.slice(0, 5).map((m) => ({
      referenceImageId: m.referenceImageId,
      labelId: m.labelId,
      similarity: m.similarity,
    })),
    retrievedChunks: textChunks.map((c) => ({
      id: c.id,
      content: c.content,
      metadata: c.metadata,
      similarity: c.similarity,
    })),
    answer: {
      diagnosis: answer.diagnosis,
      steps: answer.steps,
      why: answer.why,
      retakeTips: answer.retakeTips,
      citations: answer.citations,
    },
    clarifyingQuestions:
      answer.followUpQuestions && answer.followUpQuestions.length > 0
        ? answer.followUpQuestions
        : undefined,
    similarityStats: { topScore, secondScore, labelGap, top3Mean },
  };
}
