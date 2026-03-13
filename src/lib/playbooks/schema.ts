import { z } from "zod";

export const EVIDENCE_TYPES = [
  "photo",
  "reading",
  "observation",
  "action",
  "confirmation",
] as const;
export const LIKELIHOODS = ["high", "medium", "low"] as const;
export const VALUE_KINDS = ["photo", "boolean", "enum", "number", "text"] as const;
export const CAUSE_OUTCOMES = ["resolution", "escalation"] as const;
export const RULE_OPERATORS = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "exists",
  "missing",
  "between",
  "not_between",
] as const;
export const RULE_MODES = ["all", "any"] as const;

export type SymptomItem = {
  id: string;
  description: string;
};

export type EvidenceValueDefinition = {
  kind?: (typeof VALUE_KINDS)[number];
  options?: string[];
  unit?: string;
  unknownValues?: string[];
  notes?: string;
};

export type EvidenceItem = {
  id: string;
  description: string;
  actionId?: string;
  type: (typeof EVIDENCE_TYPES)[number];
  required: boolean;
  guideImageIds?: string[];
  valueDefinition?: EvidenceValueDefinition;
};

export type EvidenceRule = {
  evidenceId: string;
  operator?: (typeof RULE_OPERATORS)[number];
  value?: string | number | boolean;
  values?: string[];
  min?: number;
  max?: number;
  rationale?: string;
};

export type CauseItem = {
  id: string;
  cause: string;
  likelihood: (typeof LIKELIHOODS)[number];
  rulingEvidence: string[];
  outcome?: (typeof CAUSE_OUTCOMES)[number];
  supportMode?: (typeof RULE_MODES)[number];
  supportRules?: EvidenceRule[];
  excludeRules?: EvidenceRule[];
};

export type TriggerItem = {
  trigger: string;
  reason: string;
};

export type StepItem = {
  step_id: string;
  title: string;
  instruction: string;
  check?: string;
};

export const StepSchema = z.object({
  step_id: z.string().optional().default(""),
  title: z.string().optional().default(""),
  instruction: z.string().optional().default(""),
  check: z.string().optional(),
});

export const EvidenceValueDefinitionSchema = z.object({
  kind: z.enum(VALUE_KINDS).optional(),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
  unknownValues: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const EvidenceItemSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  actionId: z.string().optional(),
  type: z.enum(EVIDENCE_TYPES),
  required: z.boolean(),
  guideImageIds: z.array(z.string().uuid()).optional(),
  valueDefinition: EvidenceValueDefinitionSchema.optional(),
});

export const EvidenceRuleSchema = z
  .object({
    evidenceId: z.string().min(1),
    operator: z.enum(RULE_OPERATORS).optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    rationale: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.operator === "between" || value.operator === "not_between") &&
      (typeof value.min !== "number" || typeof value.max !== "number")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "between/not_between rules require both min and max",
      });
    }
  })
  .transform((value) => ({
    evidenceId: value.evidenceId,
    ...(value.operator ? { operator: value.operator } : {}),
    ...(
      value.values?.length || typeof value.value !== "undefined"
        ? {
            values:
              value.values?.map((item) => String(item)) ??
              [String(value.value)],
          }
        : {}
    ),
    ...(typeof value.min === "number" ? { min: value.min } : {}),
    ...(typeof value.max === "number" ? { max: value.max } : {}),
    ...(value.rationale ? { rationale: value.rationale } : {}),
  }));

export const CauseItemSchema = z.object({
  id: z.string().min(1),
  cause: z.string().min(1),
  likelihood: z.enum(LIKELIHOODS),
  rulingEvidence: z.array(z.string()),
  outcome: z.enum(CAUSE_OUTCOMES).optional(),
  supportMode: z.enum(RULE_MODES).optional(),
  supportRules: z.array(EvidenceRuleSchema).optional(),
  excludeRules: z.array(EvidenceRuleSchema).optional(),
});

export const TriggerItemSchema = z.object({
  trigger: z.string().min(1),
  reason: z.string().min(1),
});

export function playbookUsesStructuredSemantics(input: {
  evidenceChecklist?: EvidenceItem[] | null;
  candidateCauses?: CauseItem[] | null;
}): boolean {
  return Boolean(
    (input.evidenceChecklist ?? []).some((item) => item.valueDefinition) ||
      (input.candidateCauses ?? []).some(
        (cause) =>
          (cause.supportRules && cause.supportRules.length > 0) ||
          (cause.excludeRules && cause.excludeRules.length > 0) ||
          cause.supportMode
      )
  );
}

export function serializeRulesForWorkbook(value: EvidenceRule[] | undefined): string {
  if (!value || value.length === 0) return "";
  return JSON.stringify(value);
}

export function parseRulesJsonCell(value: string): EvidenceRule[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return z.array(EvidenceRuleSchema).parse(parsed);
}

export function serializeStringArrayForWorkbook(value: string[] | undefined): string {
  if (!value || value.length === 0) return "";
  return value.join(", ");
}

export function parseStringArrayCell(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
