"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CauseItem,
  EvidenceItem,
  SymptomItem,
  TriggerItem,
} from "@/lib/playbooks/schema";
import { validateAndNormalizePlaybookV2, type PlaybookValidationIssue } from "@/lib/playbooks/editor";
import type { Action, Label, Playbook, PlaybookFormState, Step } from "./types";
import { toFormState } from "./types";

type UsePlaybookEditorStateArgs = {
  actionsList: Action[];
  labels: Label[];
  dedicatedMode: boolean;
};

function buildEmptyForm(defaultLabelId = ""): PlaybookFormState {
  return {
    labelId: defaultLabelId,
    title: "",
    enabled: false,
    productTypeIds: [],
    steps: [],
    symptoms: [],
    evidenceChecklist: [],
    candidateCauses: [],
    escalationTriggers: [],
  };
}

export function usePlaybookEditorState({
  actionsList,
  labels,
  dedicatedMode,
}: UsePlaybookEditorStateArgs) {
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PlaybookFormState>(() => buildEmptyForm(labels[0]?.id ?? ""));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<PlaybookValidationIssue[]>([]);

  const actionsById = useMemo(() => new Map(actionsList.map((action) => [action.id, action])), [actionsList]);
  const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);

  const issueMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of validationIssues) {
      const current = map.get(issue.path) ?? [];
      current.push(issue.message);
      map.set(issue.path, current);
    }
    return map;
  }, [validationIssues]);

  const getIssuesForPrefix = (prefix: string): string[] => {
    const collected: string[] = [];
    for (const [path, messages] of issueMap.entries()) {
      if (path === prefix || path.startsWith(`${prefix}.`)) {
        collected.push(...messages);
      }
    }
    return collected;
  };

  const startNew = () => {
    setSaveMsg(null);
    setValidationIssues([]);
    setEditing(null);
    setShowForm(true);
    setForm(buildEmptyForm(labels[0]?.id ?? ""));
  };

  const startEditing = (playbook: Playbook) => {
    setSaveMsg(null);
    setValidationIssues([]);
    setEditing(playbook);
    setShowForm(true);
    setForm(toFormState(playbook));
  };

  const closeForm = () => {
    setEditing(null);
    setShowForm(false);
    setSaveMsg(null);
    setValidationIssues([]);
    setForm(buildEmptyForm(labels[0]?.id ?? ""));
  };

  const savePlaybook = async () => {
    const baseIssues: PlaybookValidationIssue[] = [];
    if (!form.labelId) {
      baseIssues.push({ path: "labelId", message: "Select a label before saving." });
    }
    if (!form.title.trim()) {
      baseIssues.push({ path: "title", message: "Enter a playbook title before saving." });
    }
    if (baseIssues.length > 0) {
      setValidationIssues(baseIssues);
      setSaveMsg("Fix the validation errors before saving.");
      return null;
    }

    const validation = validateAndNormalizePlaybookV2({
      evidenceChecklist: form.evidenceChecklist,
      candidateCauses: form.candidateCauses,
      actionsById,
      schemaVersion: editing?.schemaVersion ?? undefined,
    });
    if (validation.issues.length > 0) {
      setValidationIssues(validation.issues);
      setSaveMsg("Fix the validation errors before saving.");
      return null;
    }

    setValidationIssues([]);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          labelId: form.labelId,
          title: form.title,
          enabled: form.enabled,
          productTypeIds: form.productTypeIds,
          steps: form.steps,
          symptoms: form.symptoms.length ? form.symptoms : null,
          schemaVersion: validation.schemaVersion,
          evidenceChecklist: validation.normalizedEvidenceChecklist.length
            ? validation.normalizedEvidenceChecklist
            : null,
          candidateCauses: validation.normalizedCandidateCauses.length
            ? validation.normalizedCandidateCauses
            : null,
          escalationTriggers: form.escalationTriggers.length ? form.escalationTriggers : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSaveMsg(data.error ?? "Failed to save playbook.");
        setValidationIssues(Array.isArray(data.details) ? data.details : []);
        return null;
      }

      setSaveMsg("Playbook saved successfully.");
      setValidationIssues([]);
      if (dedicatedMode) {
        setEditing(data);
        setForm(toFormState(data));
      } else {
        closeForm();
      }
      return data as Playbook;
    } finally {
      setSaving(false);
    }
  };

  const addStep = () =>
    setForm((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          step_id: crypto.randomUUID(),
          title: "",
          instruction: "",
          check: "",
        },
      ],
    }));

  const updateStep = (index: number, field: keyof Step, value: string) =>
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, [field]: value } : step
      ),
    }));

  const removeStep = (index: number) =>
    setForm((current) => ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
    }));

  const addSymptom = () =>
    setForm((current) => ({
      ...current,
      symptoms: [...current.symptoms, { id: "", description: "" }],
    }));

  const updateSymptom = (index: number, field: keyof SymptomItem, value: string) =>
    setForm((current) => ({
      ...current,
      symptoms: current.symptoms.map((symptom, symptomIndex) =>
        symptomIndex === index ? { ...symptom, [field]: value } : symptom
      ),
    }));

  const removeSymptom = (index: number) =>
    setForm((current) => ({
      ...current,
      symptoms: current.symptoms.filter((_, symptomIndex) => symptomIndex !== index),
    }));

  const addEvidence = () =>
    setForm((current) => ({
      ...current,
      evidenceChecklist: [
        ...current.evidenceChecklist,
        { id: "", description: "", type: "observation", required: false, guideImageIds: [] },
      ],
    }));

  const updateEvidence = (index: number, nextEvidence: EvidenceItem) =>
    setForm((current) => ({
      ...current,
      evidenceChecklist: current.evidenceChecklist.map((item, itemIndex) =>
        itemIndex === index ? nextEvidence : item
      ),
    }));

  const removeEvidence = (index: number) =>
    setForm((current) => ({
      ...current,
      evidenceChecklist: current.evidenceChecklist.filter((_, itemIndex) => itemIndex !== index),
    }));

  const addCause = () =>
    setForm((current) => ({
      ...current,
      candidateCauses: [
        ...current.candidateCauses,
        {
          id: "",
          cause: "",
          likelihood: "medium",
          outcome: "resolution",
          supportMode: "all",
          rulingEvidence: [],
          supportRules: [],
          excludeRules: [],
        },
      ],
    }));

  const updateCause = (index: number, nextCause: CauseItem) =>
    setForm((current) => ({
      ...current,
      candidateCauses: current.candidateCauses.map((item, itemIndex) =>
        itemIndex === index ? nextCause : item
      ),
    }));

  const removeCause = (index: number) =>
    setForm((current) => ({
      ...current,
      candidateCauses: current.candidateCauses.filter((_, itemIndex) => itemIndex !== index),
    }));

  const addTrigger = () =>
    setForm((current) => ({
      ...current,
      escalationTriggers: [...current.escalationTriggers, { trigger: "", reason: "" }],
    }));

  const updateTrigger = (index: number, field: keyof TriggerItem, value: string) =>
    setForm((current) => ({
      ...current,
      escalationTriggers: current.escalationTriggers.map((trigger, triggerIndex) =>
        triggerIndex === index ? { ...trigger, [field]: value } : trigger
      ),
    }));

  const removeTrigger = (index: number) =>
    setForm((current) => ({
      ...current,
      escalationTriggers: current.escalationTriggers.filter((_, triggerIndex) => triggerIndex !== index),
    }));

  useEffect(() => {
    if (editing) return;
    if (!form.labelId && labels[0]?.id) {
      setForm((current) => ({ ...current, labelId: labels[0]?.id ?? "" }));
    }
  }, [editing, form.labelId, labels]);

  return {
    editing,
    setEditing,
    showForm,
    setShowForm,
    form,
    setForm,
    saving,
    saveMsg,
    setSaveMsg,
    validationIssues,
    setValidationIssues,
    labelsById,
    actionsById,
    getIssuesForPrefix,
    startNew,
    startEditing,
    closeForm,
    savePlaybook,
    addStep,
    updateStep,
    removeStep,
    addSymptom,
    updateSymptom,
    removeSymptom,
    addEvidence,
    updateEvidence,
    removeEvidence,
    addCause,
    updateCause,
    removeCause,
    addTrigger,
    updateTrigger,
    removeTrigger,
  };
}
