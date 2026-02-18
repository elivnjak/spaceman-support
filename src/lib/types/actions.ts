export type ExpectedInputType =
  | "photo"
  | "number"
  | "text"
  | "boolean"
  | "enum";

export type ExpectedInput = {
  type: ExpectedInputType;
  unit?: string;
  range?: { min: number; max: number };
  options?: string[];
};

export type ActionSafetyLevel = "safe" | "caution" | "technician_only";

export type ActionPayload = {
  id: string;
  title: string;
  instructions: string;
  expectedInput?: ExpectedInput | null;
  safetyLevel: ActionSafetyLevel;
  appliesToModels?: string[] | null;
};
