import "dotenv/config";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import OpenAI from "openai";
import sharp from "sharp";
import { asc, eq, inArray } from "drizzle-orm";
import {
  actions,
  playbookProductTypes,
  playbooks,
  productTypes,
  supportedModels,
} from "@/lib/db/schema";
import {
  CauseItemSchema,
  EvidenceItemSchema,
  type CauseItem as CandidateCause,
  type EvidenceItem,
  type EvidenceRule,
} from "@/lib/playbooks/schema";
import { createDatabaseClient, type SandboxDatabase } from "./sandbox";
import type { PlaybookTestScenario } from "./schema";

type PlaybookRow = typeof playbooks.$inferSelect;
type ProductTypeRow = Pick<typeof productTypes.$inferSelect, "id" | "name" | "isOther">;
type SupportedModelRow = Pick<typeof supportedModels.$inferSelect, "modelNumber">;
type ActionRow = Pick<typeof actions.$inferSelect, "id" | "title" | "expectedInput">;

type SymptomItem = {
  id: string;
  description: string;
};

type PlaybookSeed = {
  playbook: PlaybookRow;
  productTypes: ProductTypeRow[];
};

type ResolutionAnswerSeed = {
  user: string;
  inputSource?: "chat" | "structured" | "skip" | "note";
  photoLabel?: string;
};

type ResolutionBlueprint = {
  targetCauseId: string;
  answers: Record<string, ResolutionAnswerSeed>;
  defaultAnswer: {
    user: string;
    inputSource?: "chat" | "structured" | "skip" | "note";
  };
};

function buildPhotoAnswerSeed(
  playbook: PlaybookRow,
  item: EvidenceItem,
  targetCause: CandidateCause
): ResolutionAnswerSeed {
  const normalizedText = normalizeFreeform(buildEvidenceText(item));
  const normalizedCause = normalizeFreeform(targetCause.cause);
  const baseLabel = `${playbook.title}\n${targetCause.cause}\n${item.description}`;
  const displayRuleCode =
    (targetCause.supportRules ?? [])
      .filter(
        (rule) =>
          (rule.evidenceId === "ev_display_photo" || rule.evidenceId === "ev_error_code") &&
          (rule.operator === "equals" || rule.operator === "in") &&
          Array.isArray(rule.values) &&
          rule.values.length > 0
      )
      .flatMap((rule) => rule.values ?? [])
      .find((value) =>
        ["STOP 1", "STOP 2", "STOP 4", "LOW MIX", "POWER FAIL"].includes(value)
      ) ?? null;

  if (normalizedText.includes("product") || normalizedText.includes("texture")) {
    if (
      causeMentionsAny(targetCause, [
        "thick",
        "stiff",
        "icy",
        "freeze up",
        "freeze-up",
        "unmixed",
        "mixed",
        "viscous",
        "chunks",
        "particles",
      ])
    ) {
      return {
        user: "I've attached a photo. The product looks thick, dense, and not fully mixed.",
        inputSource: "chat",
        photoLabel: `${playbook.title}\nProduct looks thick, dense, clumpy, and not fully mixed.\nTarget cause: ${targetCause.cause}`,
      };
    }
    if (causeMentionsAny(targetCause, ["soft", "runny", "warm", "melted", "foamy"])) {
      return {
        user: "I've attached a photo. The product looks runny, soft, and not setting properly.",
        inputSource: "chat",
        photoLabel: `${playbook.title}\nProduct looks runny, soft, and not setting properly.\nTarget cause: ${targetCause.cause}`,
      };
    }
    if (causeMentionsAny(targetCause, ["leak", "door", "drip"])) {
      return {
        user: "I've attached a photo. You can see product leaking around the affected area.",
        inputSource: "chat",
        photoLabel: `${playbook.title}\nVisible product leak around the affected area.\nTarget cause: ${targetCause.cause}`,
      };
    }
  }

  if (normalizedText.includes("display") || normalizedText.includes("alarm") || normalizedText.includes("error")) {
    const displaySummary = displayRuleCode
      ? `Display shows ${displayRuleCode} on the affected side.`
      : causeMentionsAny(targetCause, ["operational condition", "freeze up", "freeze-up"])
      ? "Display shows STOP 1 on the affected side."
      : causeMentionsAny(targetCause, ["stop 4"])
      ? "Display shows STOP 4 on the affected side."
      : causeMentionsAny(targetCause, ["low mix"])
        ? "Display shows LOW MIX on the affected side."
        : causeMentionsAny(targetCause, ["power"])
          ? "Display shows a recent power interruption warning."
          : "Display shows the affected side in the reported state with no extra details.";
    return {
      user: `I've attached a photo. ${displaySummary}`,
      inputSource: "chat",
      photoLabel: `${playbook.title}\n${displaySummary}\nTarget cause: ${targetCause.cause}`,
    };
  }

  if (normalizedCause.includes("name plate") || normalizedText.includes("name plate")) {
    return {
      user: "I've attached the requested photo.",
      inputSource: "chat",
      photoLabel: baseLabel,
    };
  }

  return {
    user: "I've attached the requested photo.",
    inputSource: "chat",
    photoLabel: baseLabel,
  };
}

const ALLOWED_INPUT_SOURCES = new Set(["chat", "structured", "skip", "note"]);

type ExpectedInput = {
  type: string;
  unit?: string;
  range?: { min?: number; max?: number };
  options?: string[];
};

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function chooseModelNumber(playbook: PlaybookRow, models: string[]): string {
  const normalizedLabel = playbook.labelId.toLowerCase();
  const preferredPattern = normalizedLabel.startsWith("fb_") ? /^(64|65|66|67|68)/ : /^(62|63)/;
  return models.find((model) => preferredPattern.test(model)) ?? models[0] ?? "6210-C";
}

function chooseProductType(playbook: PlaybookRow, availableProductTypes: ProductTypeRow[]): string {
  const iceCream = availableProductTypes.find((item) => item.name === "Ice Cream");
  const acai = availableProductTypes.find((item) => item.name === "Acai");
  const firstConcrete = availableProductTypes.find((item) => !item.isOther);
  return playbook.labelId.startsWith("ss_")
    ? iceCream?.name ?? firstConcrete?.name ?? "Ice Cream"
    : acai?.name ?? firstConcrete?.name ?? "Acai";
}

function normalizeFreeform(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseExpectedInput(value: unknown): ExpectedInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  if (!type) return null;
  const options = Array.isArray(record.options)
    ? record.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  const rangeValue =
    record.range && typeof record.range === "object" ? (record.range as Record<string, unknown>) : undefined;
  return {
    type,
    ...(typeof record.unit === "string" ? { unit: record.unit } : {}),
    ...(rangeValue
      ? {
          range: {
            ...(typeof rangeValue.min === "number" ? { min: rangeValue.min } : {}),
            ...(typeof rangeValue.max === "number" ? { max: rangeValue.max } : {}),
          },
        }
      : {}),
    ...(options?.length ? { options } : {}),
  };
}

function normalizeOptionToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandComparableOptionTokens(value: string): string[] {
  const normalized = normalizeOptionToken(value);
  if (normalized === "true") return ["true", "yes"];
  if (normalized === "false") return ["false", "no"];
  if (normalized === "yes") return ["yes", "true"];
  if (normalized === "no") return ["no", "false"];
  return [normalized];
}

function normalizeDesiredValueForExpectedInput(
  desired: string,
  expectedInput: ExpectedInput | null
): string {
  if (expectedInput?.type?.toLowerCase() === "boolean") {
    const normalized = normalizeOptionToken(desired);
    if (normalized === "true") return "Yes";
    if (normalized === "false") return "No";
  }
  return desired;
}

function findMatchingOption(options: string[], desired: string): string | null {
  const normalizedDesired = normalizeOptionToken(desired);
  if (!normalizedDesired) return null;

  const exact = options.find((option) => normalizeOptionToken(option) === normalizedDesired);
  if (exact) return exact;

  const loose = options.find((option) => {
    const normalizedOption = normalizeOptionToken(option);
    return (
      normalizedOption.includes(normalizedDesired) || normalizedDesired.includes(normalizedOption)
    );
  });
  return loose ?? null;
}

function coerceAnswerToExpectedInput(answer: string, expectedInput: ExpectedInput | null): string {
  const trimmed = answer.trim();
  if (!expectedInput) return trimmed;

  const type = expectedInput.type.toLowerCase();
  if (expectedInput.options?.length) {
    const matched = findMatchingOption(expectedInput.options, trimmed);
    if (matched) return matched;
  }

  if (type === "boolean") {
    const normalized = normalizeOptionToken(trimmed);
    if (["yes", "y", "true"].includes(normalized)) return "Yes";
    if (["no", "n", "false"].includes(normalized)) return "No";
  }

  if (type === "number") {
    const match = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (match) return match[0];
  }

  return trimmed;
}

function buildEvidenceText(item: EvidenceItem): string {
  return `${item.id} ${item.actionId ?? ""} ${item.description}`;
}

function isUnknownOptionForItem(item: EvidenceItem, option: string): boolean {
  const normalized = normalizeOptionToken(option);
  const configuredUnknowns = item.valueDefinition?.unknownValues ?? [];
  const builtInUnknowns = new Set([
    "unknown",
    "unsure",
    "not sure",
    "skipped",
    "unable to complete safely",
    "unable to perform safely",
  ]);
  if (builtInUnknowns.has(normalized)) return true;
  return configuredUnknowns.some(
    (candidate) => normalizeOptionToken(candidate) === normalized
  );
}

function matchesNormalizedPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeFreeform(phrase).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${normalizedPhrase}\\b`).test(normalizedText);
}

function parseSymptoms(playbook: PlaybookRow): SymptomItem[] {
  if (!Array.isArray(playbook.symptoms)) return [];
  return playbook.symptoms
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const id = "id" in item && typeof item.id === "string" ? item.id : "";
      const description =
        "description" in item && typeof item.description === "string"
          ? item.description.trim()
          : "";
      if (!id || !description) return null;
      return { id, description };
    })
    .filter((item): item is SymptomItem => Boolean(item));
}

function parseEvidenceChecklist(playbook: PlaybookRow): EvidenceItem[] {
  if (!Array.isArray(playbook.evidenceChecklist)) return [];
  return playbook.evidenceChecklist
    .map((item) => EvidenceItemSchema.safeParse(item))
    .map((result) => (result.success ? result.data : null))
    .filter(isDefined);
}

function parseCandidateCauses(playbook: PlaybookRow): CandidateCause[] {
  if (!Array.isArray(playbook.candidateCauses)) return [];
  return playbook.candidateCauses
    .map((item) => CauseItemSchema.safeParse(item))
    .map((result) => (result.success ? result.data : null))
    .filter((item): item is CandidateCause => Boolean(item));
}

function getExpectedOptions(
  item: EvidenceItem,
  expectedInput: ExpectedInput | null
): string[] {
  return expectedInput?.options?.length
    ? expectedInput.options
    : item.valueDefinition?.options?.length
      ? item.valueDefinition.options
      : [];
}

function findUnknownOption(
  item: EvidenceItem,
  expectedInput: ExpectedInput | null
): string | null {
  const options = getExpectedOptions(item, expectedInput);
  const configuredUnknowns = item.valueDefinition?.unknownValues ?? [];
  for (const unknown of configuredUnknowns) {
    const matched = findMatchingOption(options, unknown);
    if (matched) return matched;
  }
  for (const fallback of [
    "Unknown",
    "Not sure",
    "Skipped",
    "Unable to complete safely",
    "Unable to perform safely",
  ]) {
    const matched = findMatchingOption(options, fallback);
    if (matched) return matched;
  }
  return null;
}

function buildStructuredAnswerFromRule(
  item: EvidenceItem,
  rule: EvidenceRule,
  expectedInput: ExpectedInput | null
): string | null {
  const options = getExpectedOptions(item, expectedInput);
  const type = (expectedInput?.type ?? item.valueDefinition?.kind ?? "").toLowerCase();

  if (rule.operator === "missing") {
    return findUnknownOption(item, expectedInput) ?? "Unknown";
  }

  if (rule.operator === "exists") {
    if (item.type === "photo" || type === "photo") {
      return "I've attached the requested photo.";
    }
    return expectedInput?.type === "boolean" ? "Yes" : "Confirmed";
  }

  if ((rule.operator === "equals" || rule.operator === "in") && rule.values?.length) {
    const desired = normalizeDesiredValueForExpectedInput(rule.values[0]!, expectedInput);
    return options.length ? findMatchingOption(options, desired) ?? desired : desired;
  }

  if (rule.operator === "between" && typeof rule.min === "number" && typeof rule.max === "number") {
    const precision = Number.isInteger(rule.min) && Number.isInteger(rule.max) ? 0 : 1;
    const step = precision === 0 ? 1 : 0.1;
    const factor = 10 ** precision;
    let candidate = (rule.min + rule.max) / 2;
    candidate = Math.round((candidate + Number.EPSILON) * factor) / factor;
    if (candidate <= rule.min) {
      candidate = rule.min + step;
    }
    if (candidate >= rule.max) {
      candidate = rule.max - step;
    }
    const value = candidate.toFixed(precision);
    return value;
  }

  if (rule.operator === "not_between" && typeof rule.min === "number" && typeof rule.max === "number") {
    return String(Math.ceil(rule.max + 1));
  }

  if ((rule.operator === "not_equals" || rule.operator === "not_in") && rule.values?.length) {
    const excluded = new Set(rule.values.flatMap((value) => expandComparableOptionTokens(value)));
    const candidate = options.find((option) => !excluded.has(normalizeOptionToken(option)));
    if (candidate) return candidate;
  }

  return null;
}

function chooseNumericOutsideBetween(input: {
  min: number;
  max: number;
  expectedInput: ExpectedInput | null;
}): string | null {
  const rangeMin = input.expectedInput?.range?.min;
  const rangeMax = input.expectedInput?.range?.max;
  const precision = Number.isInteger(input.min) && Number.isInteger(input.max) ? 0 : 1;
  const step = precision === 0 ? 1 : 0.1;
  const factor = 10 ** precision;
  const format = (value: number) =>
    (Math.round((value + Number.EPSILON) * factor) / factor).toFixed(precision);

  const belowCandidate = input.min - step;
  if (typeof rangeMin !== "number" || belowCandidate >= rangeMin) {
    return format(belowCandidate);
  }

  const aboveCandidate = input.max + step;
  if (typeof rangeMax !== "number" || aboveCandidate <= rangeMax) {
    return format(aboveCandidate);
  }

  return null;
}

function buildNonSupportingAnswerFromRule(
  item: EvidenceItem,
  rule: EvidenceRule,
  expectedInput: ExpectedInput | null
): string | null {
  const options = getExpectedOptions(item, expectedInput);
  const type = (expectedInput?.type ?? item.valueDefinition?.kind ?? "").toLowerCase();
  const unknownOption = findUnknownOption(item, expectedInput);

  if (rule.operator === "missing") {
    if (item.type === "photo" || type === "photo") {
      return "I've attached the requested photo.";
    }
    if (expectedInput?.type === "boolean") {
      return "Yes";
    }
    return options[0] ?? "Confirmed";
  }

  if (rule.operator === "exists") {
    return unknownOption ?? null;
  }

  if ((rule.operator === "equals" || rule.operator === "in") && rule.values?.length) {
    if (unknownOption) return unknownOption;
    const excluded = new Set(rule.values.flatMap((value) => expandComparableOptionTokens(value)));
    const candidate = options.find((option) => !excluded.has(normalizeOptionToken(option)));
    if (candidate) return candidate;
  }

  if ((rule.operator === "not_equals" || rule.operator === "not_in") && rule.values?.length) {
    if (unknownOption) return unknownOption;
    const desired = normalizeDesiredValueForExpectedInput(rule.values[0]!, expectedInput);
    return options.length ? findMatchingOption(options, desired) ?? desired : desired;
  }

  if (rule.operator === "between" && typeof rule.min === "number" && typeof rule.max === "number") {
    if (unknownOption) return unknownOption;
    return chooseNumericOutsideBetween({
      min: rule.min,
      max: rule.max,
      expectedInput,
    });
  }

  if (rule.operator === "not_between" && typeof rule.min === "number" && typeof rule.max === "number") {
    if (unknownOption) return unknownOption;
    const value = ((rule.min + rule.max) / 2).toFixed(
      Number.isInteger(rule.min) && Number.isInteger(rule.max) ? 0 : 1
    );
    return value;
  }

  return unknownOption;
}

function buildStructuredAnswerForEvidence(input: {
  item: EvidenceItem;
  targetCause: CandidateCause;
  competingCauses: CandidateCause[];
  expectedInput: ExpectedInput | null;
}): string | null {
  const targetSupportRules = (input.targetCause.supportRules ?? []).filter(
    (rule) => rule.evidenceId === input.item.id
  );
  const targetExcludeRules = (input.targetCause.excludeRules ?? []).filter(
    (rule) => rule.evidenceId === input.item.id
  );
  const competingSupportRules = input.competingCauses.flatMap((cause) =>
    (cause.supportRules ?? []).filter((rule) => rule.evidenceId === input.item.id)
  );
  const options = getExpectedOptions(input.item, input.expectedInput);
  const shouldScoreOptions =
    options.length > 0 &&
    (targetSupportRules.length > 0 ||
      targetExcludeRules.length > 0 ||
      competingSupportRules.length > 1);
  if (shouldScoreOptions) {
    const scoredOption = chooseBestStructuredOptionAnswer({
      item: input.item,
      targetCause: input.targetCause,
      competingCauses: input.competingCauses,
      options,
    });
    if (scoredOption) {
      return scoredOption;
    }
  }
  for (const rule of targetSupportRules) {
    const matched = buildStructuredAnswerFromRule(input.item, rule, input.expectedInput);
    if (matched) return matched;
  }

  for (const rule of targetExcludeRules) {
    const candidate = buildNonSupportingAnswerFromRule(
      input.item,
      rule,
      input.expectedInput
    );
    if (candidate) return candidate;
  }

  for (const rule of competingSupportRules) {
    const candidate = buildNonSupportingAnswerFromRule(
      input.item,
      rule,
      input.expectedInput
    );
    if (candidate) return candidate;
  }

  if (targetExcludeRules.length > 0 || competingSupportRules.length > 0) {
    return findUnknownOption(input.item, input.expectedInput);
  }

  return null;
}

function matchesOptionRule(option: string, rule: EvidenceRule): boolean {
  const normalizedOption = normalizeOptionToken(option);
  switch (rule.operator) {
    case "equals":
    case "in":
      return Boolean(
        rule.values?.some((value) =>
          expandComparableOptionTokens(value).includes(normalizedOption)
        )
      );
    case "not_equals":
    case "not_in":
      return Boolean(
        rule.values?.length &&
          rule.values.every(
            (value) => !expandComparableOptionTokens(value).includes(normalizedOption)
          )
      );
    case "missing":
      return ["unknown", "not sure", "unsure", "skipped"].includes(normalizedOption);
    default:
      return false;
  }
}

function likelihoodPenalty(likelihood: CandidateCause["likelihood"]): number {
  switch (likelihood) {
    case "high":
      return 30;
    case "medium":
      return 20;
    case "low":
      return 10;
  }
}

function chooseBestStructuredOptionAnswer(input: {
  item: EvidenceItem;
  targetCause: CandidateCause;
  competingCauses: CandidateCause[];
  options: string[];
}): string | null {
  const targetSupportRules = (input.targetCause.supportRules ?? []).filter(
    (rule) => rule.evidenceId === input.item.id
  );
  const targetExcludeRules = (input.targetCause.excludeRules ?? []).filter(
    (rule) => rule.evidenceId === input.item.id
  );

  const scored = input.options.map((option) => {
    let score = 0;
    const unknownOption = isUnknownOptionForItem(input.item, option);
    const matchedTargetSupport = targetSupportRules.filter((rule) =>
      matchesOptionRule(option, rule)
    );
    const matchedTargetExclude = targetExcludeRules.filter((rule) =>
      matchesOptionRule(option, rule)
    );

    if (targetSupportRules.length > 0) {
      const supportMode = input.targetCause.supportMode ?? "all";
      const targetSatisfied =
        supportMode === "any"
          ? matchedTargetSupport.length > 0
          : matchedTargetSupport.length === targetSupportRules.length;
      if (targetSatisfied) {
        score += 120;
      } else if (matchedTargetSupport.length > 0) {
        score += 40;
      } else {
        score -= 25;
      }
    }

    if (matchedTargetExclude.length > 0) {
      score -= 120;
    }

    if (unknownOption) {
      score -= 35;
      if (matchedTargetSupport.length > 0) {
        score -= 20;
      }
    }

    for (const cause of input.competingCauses) {
      const supportRules = (cause.supportRules ?? []).filter(
        (rule) => rule.evidenceId === input.item.id
      );
      if (supportRules.length === 0) continue;
      const matchedSupport = supportRules.filter((rule) => matchesOptionRule(option, rule));
      const supportMode = cause.supportMode ?? "all";
      const competitorSupported =
        supportMode === "any"
          ? matchedSupport.length > 0
          : matchedSupport.length === supportRules.length;
      if (!competitorSupported) continue;
      if (cause.likelihood === "low") {
        score -= 60;
      }
      score -= likelihoodPenalty(cause.likelihood);
      if (isOperatorFixableCause(cause)) {
        score -= 15;
      }
    }

    return { option, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.option ?? null;
}

function chooseSymptomText(playbook: PlaybookRow): string {
  const symptoms = parseSymptoms(playbook);
  const description = symptoms[0]?.description;
  if (description) {
    return `I need help with this machine. ${description}`;
  }
  return `I need help with this machine. ${playbook.title}`;
}

function buildManualSerial(playbook: PlaybookRow): string {
  const prefix = playbook.labelId.startsWith("fb_") ? "24FB" : "24SS";
  return `${prefix}00123`;
}

function buildSmokeScenario(input: {
  playbook: PlaybookRow;
  productTypes: ProductTypeRow[];
  availableProductTypes: ProductTypeRow[];
  supportedModels: string[];
}): PlaybookTestScenario {
  const chosenModel = chooseModelNumber(input.playbook, input.supportedModels);
  const chosenProductType =
    input.productTypes[0]?.name ?? chooseProductType(input.playbook, input.availableProductTypes);
  const scenarioId = `generated-${slugify(input.playbook.labelId)}-${slugify(input.playbook.id).slice(0, 8)}`;

  return {
    id: scenarioId,
    suite: "generated",
    description: `Autogenerated intake smoke scenario for playbook "${input.playbook.title}".`,
    tags: [
      "generated",
      `playbook:${input.playbook.id}`,
      `label:${input.playbook.labelId}`,
    ],
    initialContext: {},
    turns: [
      {
        user: chooseSymptomText(input.playbook),
        images: [],
        expect: {
          phase: "nameplate_check",
        },
      },
      {
        user: "I don't have a photo.",
        images: [],
        expect: {
          phase: "nameplate_check",
          requestedIds: ["nameplate_manual_known"],
        },
      },
      {
        user: "Yes, I know both.",
        images: [],
        expect: {
          phase: "nameplate_check",
          requestedIds: ["nameplate_manual_model"],
        },
      },
      {
        user: chosenModel,
        images: [],
        expect: {
          phase: "nameplate_check",
          requestedIds: ["nameplate_manual_serial"],
        },
      },
      {
        user: buildManualSerial(input.playbook),
        images: [],
        expect: {
          phase: "product_type_check",
          requestedIds: ["product_type"],
        },
      },
      {
        user: chosenProductType,
        images: [],
        expect: {
          phase: "clearance_check",
          requestedIds: ["clearance_photos"],
        },
      },
      {
        user: "Skip the clearance photos for now.",
        inputSource: "skip",
        images: [],
        expect: {
          playbookLabel: input.playbook.labelId,
        },
      },
    ],
    finalExpect: {
      status: "active",
      playbookLabel: input.playbook.labelId,
      maxTurns: 7,
    },
  };
}

export function buildGeneratedScenario(input: {
  playbook: PlaybookRow;
  productTypes: ProductTypeRow[];
  availableProductTypes: ProductTypeRow[];
  supportedModels: string[];
}): PlaybookTestScenario {
  return buildSmokeScenario(input);
}

function getTargetCause(playbook: PlaybookRow): CandidateCause | null {
  const causes = parseCandidateCauses(playbook);
  const operatorFixable = causes
    .filter((cause) => !isEscalationCause(cause))
    .sort(compareCausePriority);
  if (operatorFixable[0]) {
    return operatorFixable[0];
  }
  return causes.sort(compareCausePriority)[0] ?? null;
}

function getGeneratedResolutionCauses(playbook: PlaybookRow): CandidateCause[] {
  return parseCandidateCauses(playbook).sort(compareCausePriority);
}

function compareCausePriority(left: CandidateCause, right: CandidateCause): number {
  const likelihoodDelta = likelihoodScore(right.likelihood) - likelihoodScore(left.likelihood);
  if (likelihoodDelta !== 0) {
    return likelihoodDelta;
  }
  return causeSpecificityScore(right) - causeSpecificityScore(left);
}

function likelihoodScore(value: CandidateCause["likelihood"]): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function causeSpecificityScore(cause: CandidateCause): number {
  const normalizedCause = normalizeFreeform(cause.cause);
  let score = 0;
  for (const fragment of [
    "low mix",
    "door",
    "airflow",
    "brix",
    "ratio",
    "warm product",
    "scraper",
    "freeze up",
    "dirty condenser",
    "power fluctuation",
  ]) {
    if (matchesNormalizedPhrase(normalizedCause, fragment)) {
      score += 2;
    }
  }
  for (const fragment of ["operational condition", "similar", "unknown", "possible"]) {
    if (matchesNormalizedPhrase(normalizedCause, fragment)) {
      score -= fragment === "operational condition" ? 4 : 1;
    }
  }
  return score;
}

function isEscalationCause(cause: CandidateCause): boolean {
  if (cause.outcome === "escalation") {
    return true;
  }
  const normalizedCause = normalizeFreeform(cause.cause);
  if (isOperatorFixableCause(cause)) {
    return false;
  }
  return [
    "technician",
    "requires tech",
    "requires technician",
    "tech only",
    "refrigeration fault",
    "sealed system",
    "component fault",
    "sensor component fault",
    "electrical",
    "control board",
  ].some((fragment) => matchesNormalizedPhrase(normalizedCause, fragment));
}

function isOperatorFixableCause(cause: CandidateCause): boolean {
  const normalizedCause = normalizeFreeform(cause.cause);
  return [
    "airflow",
    "dirty",
    "dust",
    "grease",
    "brix",
    "ratio",
    "mix",
    "door",
    "clearance",
    "warm product",
    "pre chilled",
    "prechilled",
    "overrun",
    "scraper",
    "clean",
    "freeze up",
    "thick product",
    "blocked",
  ].some((fragment) => matchesNormalizedPhrase(normalizedCause, fragment));
}

function looksPositiveCheck(text: string): boolean {
  return /\b(ok|clear|clean|good|adequate|full|correct|pre[- ]?chilled|in freeze|normal)\b/i.test(
    text
  );
}

function causeMentionsAny(targetCause: CandidateCause, fragments: string[]): boolean {
  const normalizedCause = normalizeFreeform(targetCause.cause);
  return fragments.some((fragment) => matchesNormalizedPhrase(normalizedCause, fragment));
}

function inferBooleanAnswer(item: EvidenceItem, targetCause: CandidateCause): boolean {
  const text = buildEvidenceText(item);
  const normalizedText = normalizeFreeform(text);

  if (normalizedText.includes("high volume") || normalizedText.includes("continuous serving")) {
    return causeMentionsAny(targetCause, [
      "over pull",
      "over-pull",
      "high volume",
      "continuous serving",
      "recovery",
      "busy period",
    ]);
  }
  if (normalizedText.includes("idle")) {
    return causeMentionsAny(targetCause, ["idle", "first pull", "hot gas"]);
  }
  if (normalizedText.includes("delay observed") || normalizedText.includes("freeze delay")) {
    return causeMentionsAny(targetCause, ["misalignment", "misaligned", "foam"]);
  }
  if (normalizedText.includes("freeze mode")) {
    return !causeMentionsAny(targetCause, ["standby", "wash"]);
  }
  if (normalizedText.includes("pre chilled") || normalizedText.includes("prechilled")) {
    return !causeMentionsAny(targetCause, ["warm mix", "warm product", "warm refill"]);
  }
  if (normalizedText.includes("air tube") || normalizedText.includes("star cap")) {
    return !causeMentionsAny(targetCause, [
      "air tube",
      "star cap",
      "air system",
      "air pump",
      "pump blockage",
      "overrun",
      "blocked air",
    ]);
  }
  if (normalizedText.includes("clearance") || normalizedText.includes("airflow")) {
    return !causeMentionsAny(targetCause, [
      "airflow",
      "clearance",
      "ambient",
      "heat source",
      "high ambient",
      "vent",
      "condenser",
    ]);
  }
  if (normalizedText.includes("clean")) {
    return !causeMentionsAny(targetCause, ["dirty", "blocked", "contamination"]);
  }
  if (looksPositiveCheck(text)) {
    return !causeMentionsAny(targetCause, [
      "dirty",
      "blocked",
      "warm",
      "low",
      "worn",
      "stuck",
      "fault",
    ]);
  }
  return targetCause.rulingEvidence.includes(item.id);
}

function inferReadingAnswer(item: EvidenceItem, targetCause: CandidateCause, playbook: PlaybookRow): string {
  const normalizedText = normalizeFreeform(buildEvidenceText(item));
  const isFrozenBeverage = playbook.labelId.startsWith("fb_");

  if (normalizedText.includes("hopper temp") || normalizedText.includes("temperature")) {
    if (causeMentionsAny(targetCause, ["warm", "too high"])) {
      return isFrozenBeverage ? "12C" : "2C";
    }
    if (
      causeMentionsAny(targetCause, ["too cold", "freeze up", "thick", "icy"])
    ) {
      return "-12C";
    }
    return isFrozenBeverage ? "9C" : "-6C";
  }

  if (normalizedText.includes("brix")) {
    if (causeMentionsAny(targetCause, ["high brix", "too much sugar"])) {
      return "18 Brix";
    }
    if (causeMentionsAny(targetCause, ["low brix"])) {
      return "7 Brix";
    }
    return "12 Brix";
  }

  if (normalizedText.includes("viscosity") || normalizedText.includes("firmness")) {
    if (causeMentionsAny(targetCause, ["soft", "runny"])) {
      return "3";
    }
    if (causeMentionsAny(targetCause, ["stiff", "icy"])) {
      return "9";
    }
    return "6";
  }

  if (
    normalizedText.includes("pulls per hour") ||
    normalizedText.includes("servings pulled") ||
    normalizedText.includes("volume")
  ) {
    if (causeMentionsAny(targetCause, ["over pull", "over-pull", "high volume", "recovery"])) {
      return "90 serves per hour";
    }
    if (causeMentionsAny(targetCause, ["over beaten", "sitting too long", "idle"])) {
      return "2 serves per hour";
    }
    return "30 serves per hour";
  }

  if (normalizedText.includes("mix ratio") || normalizedText.includes("recipe ratio")) {
    if (causeMentionsAny(targetCause, ["ratio", "recipe"])) {
      return "Incorrect ratio";
    }
    return "Correct ratio";
  }

  return targetCause.rulingEvidence.includes(item.id)
    ? `The reading points to ${targetCause.id}.`
    : "The reading looks normal.";
}

function inferTextAnswer(item: EvidenceItem, targetCause: CandidateCause): string {
  const normalizedText = normalizeFreeform(buildEvidenceText(item));

  if (item.type === "confirmation") {
    if (
      (normalizedText.includes("age") || normalizedText.includes("old")) &&
      (normalizedText.includes("month") ||
        normalizedText.includes("tune up") ||
        normalizedText.includes("tune-up") ||
        normalizedText.includes("wear part"))
    ) {
      return causeMentionsAny(targetCause, [
        "tune up",
        "tune-up",
        "gasket",
        "o ring",
        "o-ring",
      ])
        ? "18"
        : "4";
    }
    if (
      normalizedText.includes("scraper") &&
      (normalizedText.includes("age") || normalizedText.includes("last replacement"))
    ) {
      return causeMentionsAny(targetCause, ["scraper", "worn"])
        ? "More than 6 months"
        : "Less than 3 months";
    }
    if (
      normalizedText.includes("date of last full clean") ||
      (normalizedText.includes("last full clean") && normalizedText.includes("sanitise"))
    ) {
      return causeMentionsAny(targetCause, ["dirty", "blocked", "contamination"])
        ? "More than 72 hours ago"
        : "Within last 72 hours";
    }
    return inferBooleanAnswer(item, targetCause) ? "Yes." : "No.";
  }

  if (normalizedText.includes("display") || normalizedText.includes("alarm") || normalizedText.includes("error")) {
    if (normalizedText.includes("error code") || normalizedText.includes("read error")) {
      if (causeMentionsAny(targetCause, ["stop 4", "sensor", "component"])) {
        return "STOP 4";
      }
      if (causeMentionsAny(targetCause, ["low mix", "door"])) {
        return "LOW MIX";
      }
      if (causeMentionsAny(targetCause, ["power"])) {
        return "POWER FAIL";
      }
      return "LOW MIX";
    }
    return causeMentionsAny(targetCause, ["stop 4"])
      ? "The display shows STOP 4 on the affected side."
      : "The display shows the issue on the affected side.";
  }
  if (normalizedText.includes("compressor") || normalizedText.includes("fan")) {
    if (causeMentionsAny(targetCause, ["refrigeration", "sealed system"])) {
      return "Compressor and fan running";
    }
    if (causeMentionsAny(targetCause, ["control"])) {
      return "Only one running";
    }
    return "Compressor and fan running";
  }
  if (normalizedText.includes("recent events") || normalizedText.includes("right before alarm")) {
    if (causeMentionsAny(targetCause, ["power"])) {
      return "There was a brief power loss right before the alarm appeared.";
    }
    if (causeMentionsAny(targetCause, ["low mix", "door"])) {
      return "It happened right after a refill and the hopper was low.";
    }
    return "It started after a refill and then the alarm stayed on.";
  }
  if (normalizedText.includes("recipe ratio") || normalizedText.includes("mix ratio")) {
    return causeMentionsAny(targetCause, ["brix", "ratio"])
      ? "Incorrect ratio"
      : "Correct ratio";
  }
  if (normalizedText.includes("airflow") || normalizedText.includes("clearance")) {
    return inferBooleanAnswer(item, targetCause)
      ? "Clear with adequate space"
      : "Blocked or no clearance";
  }
  if (normalizedText.includes("condenser")) {
    return causeMentionsAny(targetCause, ["dirty", "condenser", "airflow", "dust", "grease"])
      ? "Heavy dust or grease build-up"
      : "No visible build-up";
  }
  if (normalizedText.includes("mix level")) {
    return causeMentionsAny(targetCause, ["low mix"])
      ? "Below minimum line"
      : "Above minimum line";
  }
  if (normalizedText.includes("thick product") || normalizedText.includes("freeze up")) {
    return causeMentionsAny(targetCause, ["freeze up", "brix low"])
      ? "Yes, the product was very thick before it tripped."
      : "No, it was not unusually thick.";
  }
  if (normalizedText.includes("air tube") || normalizedText.includes("star cap")) {
    return causeMentionsAny(targetCause, [
      "air tube",
      "star cap",
      "air system",
      "air pump",
      "pump blockage",
      "overrun",
      "blocked air",
    ])
      ? "The air tube was dirty and not seated correctly."
      : "The air tube is clean and fitted correctly.";
  }
  if (normalizedText.includes("scraper")) {
    return causeMentionsAny(targetCause, ["scraper", "worn"])
      ? "The scraper blades look worn on the affected side."
      : "The scraper blades look fine.";
  }
  if (normalizedText.includes("clean")) {
    return causeMentionsAny(targetCause, ["dirty", "blocked"])
      ? "It has not been cleaned recently."
      : "It was cleaned recently.";
  }
  if (normalizedText.includes("one side")) {
    return "The left side is much softer than the right side.";
  }

  return targetCause.rulingEvidence.includes(item.id)
    ? `This points to ${targetCause.cause}.`
    : "That part seems normal.";
}

function inferEnumOptionAnswer(
  item: EvidenceItem,
  targetCause: CandidateCause,
  options: string[]
): string | null {
  const normalizedText = normalizeFreeform(buildEvidenceText(item));
  const completed = findMatchingOption(options, "completed");
  const attemptedButPersists = findMatchingOption(options, "attempted but issue persists");
  const unableSafely =
    findMatchingOption(options, "unable to complete safely") ??
    findMatchingOption(options, "unable to perform safely");
  const skipped = findMatchingOption(options, "skipped");

  if (completed || attemptedButPersists || unableSafely || skipped) {
    if (
      causeMentionsAny(targetCause, ["improper cleaning", "missed lubrication", "lack of lubrication"]) &&
      (normalizedText.includes("lubricate") ||
        normalizedText.includes("gasket") ||
        normalizedText.includes("seal") ||
        normalizedText.includes("clean"))
    ) {
      return skipped ?? attemptedButPersists ?? completed ?? unableSafely;
    }
    if (causeMentionsAny(targetCause, ["misalignment", "misaligned", "positioning"])) {
      return completed ?? attemptedButPersists ?? skipped ?? unableSafely;
    }
    if (
      causeMentionsAny(targetCause, [
        "fault",
        "overload",
        "sensor",
        "control",
        "refrigeration",
        "power",
        "wiring",
      ])
    ) {
      return attemptedButPersists ?? completed ?? skipped ?? unableSafely;
    }
    return completed ?? attemptedButPersists ?? skipped ?? unableSafely;
  }

  if (
    normalizedText.includes("scraper") &&
    (normalizedText.includes("age") || normalizedText.includes("last replacement"))
  ) {
    if (
      findMatchingOption(options, "relatively new") ||
      findMatchingOption(options, "need replacement soon")
    ) {
      return causeMentionsAny(targetCause, ["scraper", "worn"])
        ? findMatchingOption(options, "need replacement soon")
        : findMatchingOption(options, "relatively new");
    }
    return causeMentionsAny(targetCause, ["scraper", "worn"])
      ? findMatchingOption(options, "more than 6 months")
      : findMatchingOption(options, "less than 3 months");
  }

  if (normalizedText.includes("scraper")) {
    if (causeMentionsAny(targetCause, ["scraper", "worn"])) {
      return (
        findMatchingOption(options, "clearly damaged worn") ??
        findMatchingOption(options, "some wear visible") ??
        findMatchingOption(options, "good condition")
      );
    }
    return (
      findMatchingOption(options, "good condition") ??
      findMatchingOption(options, "some wear visible") ??
      findMatchingOption(options, "clearly damaged worn")
    );
  }

  if (
    findMatchingOption(options, "correct orientation") ||
    findMatchingOption(options, "incorrect orientation")
  ) {
    return causeMentionsAny(targetCause, [
      "air tube",
      "star cap",
      "blocked air",
      "air ingress",
      "overrun",
    ])
      ? findMatchingOption(options, "incorrect orientation")
      : findMatchingOption(options, "correct orientation");
  }

  if (
    findMatchingOption(options, "correct and properly seated") ||
    findMatchingOption(options, "incorrect or loose")
  ) {
    return causeMentionsAny(targetCause, [
      "air tube",
      "star cap",
      "air system",
      "blocked air",
      "overrun",
      "misfit",
      "mis installed",
      "mis-installed",
      "loose",
    ])
      ? findMatchingOption(options, "incorrect or loose")
      : findMatchingOption(options, "correct and properly seated");
  }

  if (
    findMatchingOption(options, "cleaned within 30 days") ||
    findMatchingOption(options, "cleaned over 30 days ago")
  ) {
    return causeMentionsAny(targetCause, ["dirty", "condenser", "airflow", "dust", "grease"])
      ? findMatchingOption(options, "cleaned over 30 days ago")
      : findMatchingOption(options, "cleaned within 30 days");
  }

  if (normalizedText.includes("mix level")) {
    return causeMentionsAny(targetCause, ["low mix"])
      ? findMatchingOption(options, "below minimum line")
      : findMatchingOption(options, "above minimum line");
  }

  if (normalizedText.includes("last full clean") || normalizedText.includes("sanitise")) {
    return causeMentionsAny(targetCause, [
      "dirty",
      "blocked",
      "contamination",
      "improper cleaning",
      "missed lubrication",
      "lack of lubrication",
    ])
      ? findMatchingOption(options, "more than 72 hours ago")
      : findMatchingOption(options, "within last 72 hours");
  }

  if (
    findMatchingOption(options, "no visible wear") ||
    findMatchingOption(options, "worn or flattened") ||
    findMatchingOption(options, "damaged or cracked")
  ) {
    if (causeMentionsAny(targetCause, ["damaged", "crack"])) {
      return (
        findMatchingOption(options, "damaged or cracked") ??
        findMatchingOption(options, "worn or flattened") ??
        findMatchingOption(options, "no visible wear")
      );
    }
    if (causeMentionsAny(targetCause, ["seal", "gasket", "o ring", "o-ring", "tune up", "tune-up"])) {
      return (
        findMatchingOption(options, "worn or flattened") ??
        findMatchingOption(options, "damaged or cracked") ??
        findMatchingOption(options, "no visible wear")
      );
    }
    return findMatchingOption(options, "no visible wear");
  }

  if (
    findMatchingOption(options, "breaker or rcd tripped") ||
    findMatchingOption(options, "not tripped")
  ) {
    return causeMentionsAny(targetCause, ["power", "breaker", "trip", "overloaded circuit"])
      ? findMatchingOption(options, "breaker or rcd tripped")
      : findMatchingOption(options, "not tripped");
  }

  if (
    findMatchingOption(options, "outlet on and plug secure") ||
    findMatchingOption(options, "outlet off") ||
    findMatchingOption(options, "plug loose or disconnected")
  ) {
    if (causeMentionsAny(targetCause, ["plug loose", "disconnected", "loose connection"])) {
      return findMatchingOption(options, "plug loose or disconnected");
    }
    if (causeMentionsAny(targetCause, ["site power", "outlet", "power supply"])) {
      return (
        findMatchingOption(options, "outlet off") ??
        findMatchingOption(options, "plug loose or disconnected") ??
        findMatchingOption(options, "outlet on and plug secure")
      );
    }
    return findMatchingOption(options, "outlet on and plug secure");
  }

  if (
    findMatchingOption(options, "visible bend or damage") ||
    findMatchingOption(options, "stiff but no visible damage")
  ) {
    return causeMentionsAny(targetCause, [
      "mechanical damage",
      "damaged valve",
      "damaged linkage",
      "bent",
      "broken",
      "linkage",
      "mechanical",
    ])
      ? (
          findMatchingOption(options, "visible bend or damage") ??
          findMatchingOption(options, "stiff but no visible damage")
        )
      : (
          findMatchingOption(options, "stiff but no visible damage") ??
          findMatchingOption(options, "visible bend or damage")
        );
  }

  return null;
}

export function buildFallbackResolutionBlueprintForCause(
  playbook: PlaybookRow,
  targetCause: CandidateCause,
  actionsById: Map<string, ActionRow> = new Map()
): ResolutionBlueprint | null {
  const evidenceChecklist = parseEvidenceChecklist(playbook);
  const candidateCauses = parseCandidateCauses(playbook);
  const normalizedTargetCause = CauseItemSchema.safeParse(targetCause);
  if (!normalizedTargetCause.success || evidenceChecklist.length === 0) {
    return null;
  }
  const resolvedTargetCause = normalizedTargetCause.data;

  const answers: Record<string, ResolutionAnswerSeed> = {};
  for (const item of evidenceChecklist) {
    const linkedAction = item.actionId ? actionsById.get(item.actionId) : undefined;
    const expectedInput = parseExpectedInput(linkedAction?.expectedInput);
    const enumOptions = getExpectedOptions(item, expectedInput);
    const structuredAnswer = buildStructuredAnswerForEvidence({
      item,
      targetCause: resolvedTargetCause,
      competingCauses: candidateCauses.filter((cause) => cause.id !== resolvedTargetCause.id),
      expectedInput,
    });
    const enumOptionAnswer =
      !structuredAnswer && enumOptions.length > 0
        ? inferEnumOptionAnswer(item, resolvedTargetCause, enumOptions)
        : null;
    const rawUser =
      item.type === "photo"
        ? "I've attached the requested photo."
        : structuredAnswer
          ? structuredAnswer
        : enumOptionAnswer
          ? enumOptionAnswer
        : item.type === "reading"
          ? inferReadingAnswer(item, resolvedTargetCause, playbook)
          : inferTextAnswer(item, resolvedTargetCause);
    const answer: ResolutionAnswerSeed =
      item.type === "photo"
        ? buildPhotoAnswerSeed(playbook, item, resolvedTargetCause)
        : {
            user: coerceAnswerToExpectedInput(rawUser, expectedInput),
            inputSource: "structured",
          };
    answers[item.id] = answer;
    if (item.actionId) {
      answers[item.actionId] = answer;
    }
  }

  return {
    targetCauseId: resolvedTargetCause.id,
    answers,
    defaultAnswer: {
      user: "I checked that and it still matches the issue on the machine.",
    },
  };
}

function buildFallbackResolutionBlueprint(
  playbook: PlaybookRow,
  actionsById: Map<string, ActionRow> = new Map()
): ResolutionBlueprint | null {
  const targetCause = getTargetCause(playbook);
  if (!targetCause) return null;
  return buildFallbackResolutionBlueprintForCause(playbook, targetCause, actionsById);
}

async function buildAiResolutionBlueprint(
  playbook: PlaybookRow,
  actionsById: Map<string, ActionRow> = new Map()
): Promise<ResolutionBlueprint | null> {
  const client = getOpenAI();
  const evidenceChecklist = parseEvidenceChecklist(playbook);
  const candidateCauses = parseCandidateCauses(playbook);
  if (!client || evidenceChecklist.length === 0 || candidateCauses.length === 0) {
    return null;
  }

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You generate regression-test answer maps for a diagnostic chatbot. Return JSON only. Choose one candidate cause that should resolve without escalation. For each evidence item, provide a concise user answer that supports that target cause. For photo items, include a short photo_label string that can be rendered onto a placeholder image. Use natural yes/no replies for confirmation items and concrete numeric/display values for readings. Avoid hazardous situations and do not choose escalation-only paths.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            playbook: {
              labelId: playbook.labelId,
              title: playbook.title,
              symptoms: parseSymptoms(playbook),
              evidenceChecklist,
              candidateCauses,
              steps: playbook.steps,
            },
            outputSchema: {
              targetCauseId: "string",
              answersByEvidenceId: {
                "<evidence_id>": {
                  user: "string",
                  inputSource: "chat | structured | skip | note | omitted",
                  photoLabel: "string | omitted",
                },
              },
            },
          },
          null,
          2
        ),
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return null;

  const parsed = JSON.parse(raw) as {
    targetCauseId?: string;
    answersByEvidenceId?: Record<
      string,
      {
        user?: string;
        inputSource?: "chat" | "structured" | "skip" | "note";
        photoLabel?: string;
      }
    >;
  };

  const targetCauseId = parsed.targetCauseId;
  if (!targetCauseId || !candidateCauses.some((cause) => cause.id === targetCauseId)) {
    return null;
  }

  const answers: Record<string, ResolutionAnswerSeed> = {};
  for (const item of evidenceChecklist) {
    const aiAnswer = parsed.answersByEvidenceId?.[item.id];
    const fallback = buildFallbackResolutionBlueprint(playbook, actionsById)?.answers[item.id];
    const linkedAction = item.actionId ? actionsById.get(item.actionId) : undefined;
    const expectedInput = parseExpectedInput(linkedAction?.expectedInput);
    const rawUser = aiAnswer?.user?.trim() || fallback?.user;
    const user = rawUser ? coerceAnswerToExpectedInput(rawUser, expectedInput) : undefined;
    if (!user) continue;
    const answer: ResolutionAnswerSeed = {
      user,
      ...(aiAnswer?.inputSource && ALLOWED_INPUT_SOURCES.has(aiAnswer.inputSource)
        ? { inputSource: aiAnswer.inputSource }
        : {}),
      ...(item.type === "photo"
        ? {
            photoLabel:
              aiAnswer?.photoLabel?.trim() ||
              fallback?.photoLabel ||
              `${playbook.title}\n${item.description}`,
          }
        : {}),
    };
    answers[item.id] = answer;
    if (item.actionId) {
      answers[item.actionId] = answer;
    }
  }

  return {
    targetCauseId,
    answers,
    defaultAnswer: {
      user: "I checked that and it still matches the issue on the machine.",
    },
  };
}

async function buildResolutionBlueprint(
  playbook: PlaybookRow,
  actionsById: Map<string, ActionRow> = new Map()
): Promise<ResolutionBlueprint | null> {
  if (process.env.PLAYBOOK_TEST_GENERATOR_USE_AI === "true") {
    try {
      const aiBlueprint = await buildAiResolutionBlueprint(playbook, actionsById);
      if (aiBlueprint) return aiBlueprint;
    } catch {
      // fall back to deterministic answers
    }
  }
  return buildFallbackResolutionBlueprint(playbook, actionsById);
}

async function buildResolutionBlueprintForCause(
  playbook: PlaybookRow,
  targetCause: CandidateCause,
  actionsById: Map<string, ActionRow> = new Map()
): Promise<ResolutionBlueprint | null> {
  if (process.env.PLAYBOOK_TEST_GENERATOR_USE_AI === "true") {
    try {
      const aiBlueprint = await buildAiResolutionBlueprint(playbook, actionsById);
      if (aiBlueprint?.targetCauseId === targetCause.id) {
        return aiBlueprint;
      }
    } catch {
      // fall back to deterministic answers
    }
  }
  return buildFallbackResolutionBlueprintForCause(playbook, targetCause, actionsById);
}

async function createPlaceholderImage(filePath: string, label: string) {
  const lines = label.split(/\r?\n/g).filter(Boolean).slice(0, 6);
  const svg = `
    <svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1f2937" />
          <stop offset="100%" stop-color="#111827" />
        </linearGradient>
      </defs>
      <rect width="1200" height="800" rx="36" fill="url(#bg)" />
      <rect x="48" y="48" width="1104" height="704" rx="24" fill="#f3f4f6" />
      <text x="90" y="150" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#111827">
        Generated Test Placeholder
      </text>
      ${lines
        .map(
          (line, index) =>
            `<text x="90" y="${230 + index * 72}" font-family="Arial, sans-serif" font-size="42" fill="#111827">${line
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")}</text>`
        )
        .join("\n")}
    </svg>
  `;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

function buildResolutionScenario(input: {
  playbook: PlaybookRow;
  productTypes: ProductTypeRow[];
  availableProductTypes: ProductTypeRow[];
  supportedModels: string[];
  blueprint: ResolutionBlueprint;
  suite?: string;
  idPrefix?: string;
  descriptionPrefix?: string;
}): PlaybookTestScenario {
  const chosenModel = chooseModelNumber(input.playbook, input.supportedModels);
  const chosenProductType =
    input.productTypes[0]?.name ?? chooseProductType(input.playbook, input.availableProductTypes);
  const targetCause =
    parseCandidateCauses(input.playbook).find((cause) => cause.id === input.blueprint.targetCauseId) ??
    null;
  const autoTurns = Math.min(
    18,
    Math.max(8, parseEvidenceChecklist(input.playbook).filter((item) => item.required).length + 8)
  );
  const scenarioId = `${input.idPrefix ?? "generated-resolution"}-${slugify(input.playbook.labelId)}-${slugify(input.playbook.id).slice(0, 8)}${input.blueprint.targetCauseId ? `-${slugify(input.blueprint.targetCauseId).slice(0, 24)}` : ""}`;

  const autoAnswers = Object.fromEntries(
    Object.entries(input.blueprint.answers).map(([requestId, answer]) => {
      const imageFileName =
        answer.photoLabel != null
          ? `${slugify(requestId).slice(0, 48) || "photo"}-placeholder.png`
          : null;
      return [
        requestId,
        {
          user: answer.user,
          ...(answer.inputSource ? { inputSource: answer.inputSource } : {}),
          images: imageFileName ? [imageFileName] : [],
          ...(answer.photoLabel ? { imageLabel: answer.photoLabel } : {}),
        },
      ];
    })
  );
  return {
    id: scenarioId,
    suite: input.suite ?? "generated-resolution",
    description: `${input.descriptionPrefix ?? "Autogenerated resolution scenario"} for playbook "${input.playbook.title}" targeting cause "${input.blueprint.targetCauseId}".`,
    tags: [
      "generated",
      "resolution",
      `playbook:${input.playbook.id}`,
      `label:${input.playbook.labelId}`,
      `cause:${input.blueprint.targetCauseId}`,
    ],
    autoResponse: {
      targetCauseId: input.blueprint.targetCauseId,
      answers: autoAnswers,
      defaultAnswer: {
        user: input.blueprint.defaultAnswer.user,
        images: [],
        ...(input.blueprint.defaultAnswer.inputSource
          ? { inputSource: input.blueprint.defaultAnswer.inputSource }
          : {}),
      },
    },
    initialContext: {},
    turns: [
      {
        user: chooseSymptomText(input.playbook),
        images: [],
        expect: {
          phase: "nameplate_check",
        },
      },
      {
        user: "I don't have a photo.",
        images: [],
        expect: {
          phase: "nameplate_check",
          requestedIds: ["nameplate_manual_known"],
        },
      },
      {
        user: "Yes, I know both.",
        images: [],
        expect: {
          phase: "nameplate_check",
          requestedIds: ["nameplate_manual_model"],
        },
      },
      {
        user: chosenModel,
        images: [],
        expect: {
          phase: "nameplate_check",
          requestedIds: ["nameplate_manual_serial"],
        },
      },
      {
        user: buildManualSerial(input.playbook),
        images: [],
        expect: {
          phase: "product_type_check",
          requestedIds: ["product_type"],
        },
      },
      {
        user: chosenProductType,
        images: [],
        expect: {
          phase: "clearance_check",
          requestedIds: ["clearance_photos"],
        },
      },
      {
        user: "Skip the clearance photos for now.",
        inputSource: "skip",
        images: [],
        expect: {
          playbookLabel: input.playbook.labelId,
        },
      },
      ...Array.from({ length: autoTurns }, () => ({
        user: "__auto__",
        autoRespond: true,
        images: [],
        expect: {
          playbookLabel: input.playbook.labelId,
        },
      })),
    ],
    finalExpect: {
      ...(targetCause?.outcome === "escalation"
        ? {}
        : {
            status: "resolved",
            phase: "resolving",
          }),
      playbookLabel: input.playbook.labelId,
      causeId: input.blueprint.targetCauseId,
      ...(targetCause?.outcome === "escalation" ? {} : { minResolutionSteps: 1 }),
      maxTurns: 7 + autoTurns,
    },
  };
}

export async function loadEnabledPlaybookSeeds(
  db: SandboxDatabase
): Promise<PlaybookSeed[]> {
  const playbookRows = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.enabled, true))
    .orderBy(asc(playbooks.title));

  const playbookIds = playbookRows.map((playbook) => playbook.id);
  const mappings =
    playbookIds.length === 0
      ? []
      : await db
          .select({
            playbookId: playbookProductTypes.playbookId,
            productTypeId: playbookProductTypes.productTypeId,
            productTypeName: productTypes.name,
            isOther: productTypes.isOther,
          })
          .from(playbookProductTypes)
          .innerJoin(productTypes, eq(playbookProductTypes.productTypeId, productTypes.id))
          .where(inArray(playbookProductTypes.playbookId, playbookIds));

  const productTypesByPlaybookId = new Map<string, ProductTypeRow[]>();
  for (const mapping of mappings) {
    const existing = productTypesByPlaybookId.get(mapping.playbookId) ?? [];
    existing.push({
      id: mapping.productTypeId,
      name: mapping.productTypeName,
      isOther: mapping.isOther,
    });
    productTypesByPlaybookId.set(mapping.playbookId, existing);
  }

  return playbookRows.map((playbook) => ({
    playbook,
    productTypes: productTypesByPlaybookId.get(playbook.id) ?? [],
  }));
}

export async function loadReferenceData(db: SandboxDatabase): Promise<{
  productTypes: ProductTypeRow[];
  supportedModels: string[];
  actionsById: Map<string, ActionRow>;
}> {
  const [productTypeRows, supportedModelRows, actionRows] = await Promise.all([
    db
      .select({
        id: productTypes.id,
        name: productTypes.name,
        isOther: productTypes.isOther,
      })
      .from(productTypes)
      .orderBy(asc(productTypes.sortOrder), asc(productTypes.name)),
    db
      .select({ modelNumber: supportedModels.modelNumber })
      .from(supportedModels)
      .orderBy(asc(supportedModels.modelNumber)),
    db
      .select({
        id: actions.id,
        title: actions.title,
        expectedInput: actions.expectedInput,
      })
      .from(actions)
      .orderBy(asc(actions.id)),
  ]);

  return {
    productTypes: productTypeRows,
    supportedModels: supportedModelRows.map((row: SupportedModelRow) => row.modelNumber),
    actionsById: new Map(actionRows.map((row: ActionRow) => [row.id, row])),
  };
}

export async function writeGeneratedScenarios(options: {
  rootDir: string;
  scenarios: PlaybookTestScenario[];
}) {
  const generatedIds = new Set(options.scenarios.map((scenario) => scenario.id));
  const existingEntries = await readdir(options.rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of existingEntries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("generated")) continue;
    if (generatedIds.has(entry.name)) continue;
    await rm(path.join(options.rootDir, entry.name), { recursive: true, force: true });
  }

  for (const scenario of options.scenarios) {
    const scenarioDir = path.join(options.rootDir, scenario.id);
    const fixturesDir = path.join(scenarioDir, "fixtures");
    await mkdir(fixturesDir, { recursive: true });
    await writeFile(
      path.join(scenarioDir, "scenario.json"),
      `${JSON.stringify(scenario, null, 2)}\n`,
      "utf-8"
    );

    const rendered = new Set<string>();
    for (const answer of Object.values(scenario.autoResponse?.answers ?? {})) {
      for (const imagePath of answer.images) {
        if (rendered.has(imagePath)) continue;
        rendered.add(imagePath);
        const labelSource =
          Object.entries(scenario.autoResponse?.answers ?? {}).find(([, candidate]) =>
            candidate.images.includes(imagePath)
          )?.[1].imageLabel ??
          scenario.description;
        await createPlaceholderImage(
          path.join(fixturesDir, imagePath),
          labelSource
        );
      }
    }
  }
}

export async function generatePlaybookScenarios(rootDir: string) {
  const database = createDatabaseClient();
  try {
    const [playbookSeeds, referenceData] = await Promise.all([
      loadEnabledPlaybookSeeds(database.db),
      loadReferenceData(database.db),
    ]);

    const smokeScenarios = playbookSeeds.map((seed) =>
      buildSmokeScenario({
        playbook: seed.playbook,
        productTypes: seed.productTypes,
        availableProductTypes: referenceData.productTypes,
        supportedModels: referenceData.supportedModels,
      })
    );

    const resolutionScenarios: PlaybookTestScenario[] = [];
    for (const seed of playbookSeeds) {
      const blueprint = await buildResolutionBlueprint(
        seed.playbook,
        referenceData.actionsById
      );
      if (!blueprint) continue;
      resolutionScenarios.push(
        buildResolutionScenario({
          playbook: seed.playbook,
          productTypes: seed.productTypes,
          availableProductTypes: referenceData.productTypes,
          supportedModels: referenceData.supportedModels,
          blueprint,
          suite: "generated-resolution",
          idPrefix: "generated-resolution",
          descriptionPrefix: "Autogenerated primary resolution scenario",
        })
      );
    }

    const causeResolutionScenarios: PlaybookTestScenario[] = [];
    for (const seed of playbookSeeds) {
      for (const targetCause of getGeneratedResolutionCauses(seed.playbook)) {
        const blueprint = await buildResolutionBlueprintForCause(
          seed.playbook,
          targetCause,
          referenceData.actionsById
        );
        if (!blueprint) continue;
        causeResolutionScenarios.push(
          buildResolutionScenario({
            playbook: seed.playbook,
            productTypes: seed.productTypes,
            availableProductTypes: referenceData.productTypes,
            supportedModels: referenceData.supportedModels,
            blueprint,
            suite: "generated-cause-resolution",
            idPrefix: "generated-cause-resolution",
            descriptionPrefix: "Autogenerated cause-specific resolution scenario",
          })
        );
      }
    }

    const scenarios = [...smokeScenarios, ...resolutionScenarios, ...causeResolutionScenarios];
    await writeGeneratedScenarios({ rootDir, scenarios });
    return scenarios;
  } finally {
    await database.close();
  }
}
