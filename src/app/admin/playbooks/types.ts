import type {
  CauseItem,
  EvidenceItem,
  SymptomItem,
  TriggerItem,
} from "@/lib/playbooks/schema";
import type { ExpectedInput } from "@/lib/types/actions";

export type Label = {
  id: string;
  displayName: string;
  description?: string | null;
};

export type Action = {
  id: string;
  title: string;
  instructions?: string;
  expectedInput?: ExpectedInput | null;
  safetyLevel?: string;
  appliesToModels?: string[] | null;
};

export type Step = {
  step_id: string;
  title: string;
  instruction: string;
  check?: string;
};

export type ProductTypeOption = {
  id: string;
  name: string;
  isOther: boolean;
};

export type Playbook = {
  id: string;
  labelId: string;
  title: string;
  enabled: boolean;
  productTypeIds?: string[];
  steps: Step[];
  schemaVersion?: number;
  symptoms?: SymptomItem[] | null;
  evidenceChecklist?: EvidenceItem[] | null;
  candidateCauses?: CauseItem[] | null;
  escalationTriggers?: TriggerItem[] | null;
  updatedAt: string;
};

export type PlaybookFormState = {
  labelId: string;
  title: string;
  enabled: boolean;
  productTypeIds: string[];
  steps: Step[];
  symptoms: SymptomItem[];
  evidenceChecklist: EvidenceItem[];
  candidateCauses: CauseItem[];
  escalationTriggers: TriggerItem[];
};

export const PLAYBOOK_TABS = [
  "overview",
  "symptoms",
  "evidence",
  "causes",
  "triggers",
  "steps",
] as const;

export type PlaybookTab = (typeof PLAYBOOK_TABS)[number];

export function toFormState(playbook: Playbook): PlaybookFormState {
  return {
    labelId: playbook.labelId,
    title: playbook.title,
    enabled: Boolean(playbook.enabled),
    productTypeIds: Array.isArray(playbook.productTypeIds) ? playbook.productTypeIds : [],
    steps: Array.isArray(playbook.steps) ? playbook.steps : [],
    symptoms: Array.isArray(playbook.symptoms) ? playbook.symptoms : [],
    evidenceChecklist: Array.isArray(playbook.evidenceChecklist) ? playbook.evidenceChecklist : [],
    candidateCauses: Array.isArray(playbook.candidateCauses) ? playbook.candidateCauses : [],
    escalationTriggers: Array.isArray(playbook.escalationTriggers) ? playbook.escalationTriggers : [],
  };
}
