"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import type {
  CauseItem,
  EvidenceItem,
  EvidenceRule,
  EvidenceValueDefinition,
} from "@/lib/playbooks/schema";
import {
  CAUSE_OUTCOMES,
  LIKELIHOODS,
  RULE_MODES,
  VALUE_KINDS,
  type EvidenceRule as EvidenceRuleType,
} from "@/lib/playbooks/schema";
import {
  getAllowedRuleOperators,
  getEffectiveValueDefinition,
  getRuleSelectableValues,
  type PlaybookEditorActionLike,
} from "@/lib/playbooks/editor";
import type { ActionSafetyLevel, ExpectedInput, ExpectedInputType } from "@/lib/types/actions";

export type EditorActionOption = PlaybookEditorActionLike & {
  title: string;
  instructions?: string;
  safetyLevel?: string;
  appliesToModels?: string[] | null;
};

export type EditorLabelOption = {
  id: string;
  displayName: string;
  description?: string | null;
};

type SearchableOption = {
  value: string;
  label: string;
  description?: string | null;
};

type SearchableSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  label?: string;
  placeholder?: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
};

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function InlineIssues({ issues }: { issues?: string[] }) {
  if (!issues || issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-red-700">
      {issues.map((issue, index) => (
        <li key={`${issue}-${index}`}>{issue}</li>
      ))}
    </ul>
  );
}

function ModalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function CauseSectionCard({
  title,
  count,
  tone = "neutral",
  helper,
  actions,
  children,
  testId,
}: {
  title: string;
  count?: number;
  tone?: "neutral" | "support" | "exclude";
  helper?: string;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const toneClassName =
    tone === "support"
      ? "border-emerald-200 bg-emerald-50/70"
      : tone === "exclude"
        ? "border-amber-200 bg-amber-50/70"
        : "border-border bg-page/60";
  const badgeVariant = tone === "support" ? "success" : tone === "exclude" ? "warning" : "default";

  return (
    <div data-testid={testId} className={`rounded-xl border p-4 ${toneClassName}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-ink">{title}</h4>
            {typeof count === "number" ? <Badge variant={badgeVariant}>{count}</Badge> : null}
          </div>
          {helper ? <p className="text-xs text-muted">{helper}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function SearchableSelect({
  value,
  onChange,
  options,
  label,
  placeholder = "Search…",
  emptyLabel = "No selection",
  allowEmpty = false,
  disabled = false,
}: SearchableSelectProps) {
  const inputId = useId();
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  const filtered = useMemo(() => {
    const pattern = normalizeSearchText(query);
    if (!pattern) return options;
    return options.filter((option) => {
      const haystack = normalizeSearchText(`${option.value} ${option.label} ${option.description ?? ""}`);
      return haystack.includes(pattern);
    });
  }, [options, query]);

  useEffect(() => {
    if (!selected) {
      setQuery("");
      return;
    }
    setQuery(selected.label === selected.value ? selected.label : `${selected.label} ${selected.value}`);
  }, [selected?.label, selected?.value]);

  return (
    <div className="space-y-2">
      {label ? <label htmlFor={inputId} className="text-xs font-medium text-muted">{label}</label> : null}
      <input
        id={inputId}
        type="text"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="block w-full rounded border border-border px-3 py-2 text-sm"
      />
      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-3 py-2 text-xs text-muted">
          {selected ? (
            <span>
              Selected: <span className="font-medium text-ink">{selected.label}</span> ({selected.value})
            </span>
          ) : (
            <span>{emptyLabel}</span>
          )}
        </div>
        <div className="max-h-48 overflow-y-auto p-2">
          <div className="space-y-2">
            {allowEmpty ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange("")}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  !value
                    ? "border-primary bg-aqua/30 text-ink"
                    : "border-border bg-page hover:bg-aqua/20"
                } ${disabled ? "opacity-50" : ""}`}
              >
                {value ? "Clear selection" : emptyLabel}
              </button>
            ) : null}
            {filtered.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(option.value)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "border-primary bg-aqua/30"
                      : "border-border bg-page hover:bg-aqua/20"
                  } ${disabled ? "opacity-50" : ""}`}
                >
                  <div className="text-sm font-medium text-ink">
                    {option.label} <span className="text-muted">({option.value})</span>
                  </div>
                  {option.description ? <div className="mt-1 text-xs text-muted">{option.description}</div> : null}
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted">
                No matching options.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatExpectedInputSummary(expectedInput: ExpectedInput | null | undefined): string[] {
  if (!expectedInput) return ["No expected input defined."];
  if (expectedInput.type === "photo") return ["Photo upload required."];
  if (expectedInput.type === "number") {
    const lines = ["Number input"];
    if (expectedInput.unit) lines.push(`Unit: ${expectedInput.unit}`);
    if (expectedInput.range) lines.push(`Range: ${expectedInput.range.min} to ${expectedInput.range.max}`);
    return lines;
  }
  if (expectedInput.type === "enum" || expectedInput.type === "boolean") {
    return [
      expectedInput.type === "boolean" ? "Boolean input" : "Enum input",
      `Options: ${(expectedInput.options ?? []).join(", ") || "None"}`,
    ];
  }
  return ["Free-text input"];
}

function serializeModelList(value: string[] | null | undefined): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

function parseModelList(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

const ACTION_SAFETY_OPTIONS: ActionSafetyLevel[] = ["safe", "caution", "technician_only"];

export function ActionQuickEditModal({
  open,
  mode,
  action,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  action: EditorActionOption | null;
  onClose: () => void;
  onSaved: (action: EditorActionOption) => void;
}) {
  const idFieldId = useId();
  const titleFieldId = useId();
  const instructionsFieldId = useId();
  const expectedInputFieldId = useId();
  const safetyFieldId = useId();
  const unitFieldId = useId();
  const appliesToModelsFieldId = useId();
  const rangeMinFieldId = useId();
  const rangeMaxFieldId = useId();
  const optionsFieldId = useId();
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [expectedInputType, setExpectedInputType] = useState<ExpectedInputType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [unit, setUnit] = useState("");
  const [rangeMin, setRangeMin] = useState("");
  const [rangeMax, setRangeMax] = useState("");
  const [safetyLevel, setSafetyLevel] = useState<ActionSafetyLevel>("safe");
  const [appliesToModels, setAppliesToModels] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!open) return;
    if (mode === "edit" && action) {
      setId(action.id);
      setTitle(action.title);
      setInstructions(action.instructions ?? "");
      setExpectedInputType(action.expectedInput?.type ?? "text");
      setOptionsText((action.expectedInput?.options ?? []).join("\n"));
      setUnit(action.expectedInput?.unit ?? "");
      setRangeMin(
        typeof action.expectedInput?.range?.min === "number" ? String(action.expectedInput.range.min) : ""
      );
      setRangeMax(
        typeof action.expectedInput?.range?.max === "number" ? String(action.expectedInput.range.max) : ""
      );
      setSafetyLevel((action.safetyLevel as ActionSafetyLevel | undefined) ?? "safe");
      setAppliesToModels(serializeModelList(action.appliesToModels));
      return;
    }
    setId("");
    setTitle("");
    setInstructions("");
    setExpectedInputType("text");
    setOptionsText("");
    setUnit("");
    setRangeMin("");
    setRangeMax("");
    setSafetyLevel("safe");
    setAppliesToModels("");
  }, [action, mode, open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const hasRangeMin = rangeMin.trim().length > 0;
      const hasRangeMax = rangeMax.trim().length > 0;
      if (expectedInputType === "number" && hasRangeMin !== hasRangeMax) {
        setError("Number ranges require both min and max.");
        return;
      }

      const expectedInput: ExpectedInput =
        expectedInputType === "number"
          ? {
              type: "number",
              unit: unit.trim() || undefined,
              range:
                hasRangeMin && hasRangeMax
                  ? {
                      min: Number(rangeMin),
                      max: Number(rangeMax),
                    }
                  : undefined,
            }
          : expectedInputType === "enum"
            ? { type: "enum", options: parseLines(optionsText) }
            : expectedInputType === "boolean"
              ? {
                  type: "boolean",
                  options: parseLines(optionsText).length ? parseLines(optionsText) : ["Yes", "No"],
                }
              : expectedInputType === "photo"
                ? { type: "photo" }
                : { type: "text" };

      const payload = {
        ...(mode === "create" ? { id } : {}),
        title,
        instructions,
        expectedInput,
        safetyLevel,
        appliesToModels: parseModelList(appliesToModels),
      };

      const response = await fetch(
        mode === "create" ? "/api/admin/actions" : `/api/admin/actions/${action?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Failed to save action.");
        return;
      }
      onSaved(data);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl">
      <ModalSection title={mode === "create" ? "Create action" : `Edit action: ${action?.title ?? ""}`}>
        <div className="space-y-4">
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          {mode === "create" ? (
            <div>
              <label htmlFor={idFieldId} className="text-sm font-medium text-muted">Action ID</label>
              <input
                id={idFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2"
                value={id}
                onChange={(event) => setId(event.target.value)}
              />
            </div>
          ) : null}
          <div>
            <label htmlFor={titleFieldId} className="text-sm font-medium text-muted">Title</label>
            <input
              id={titleFieldId}
              className="mt-1 block w-full rounded border border-border px-3 py-2"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={instructionsFieldId} className="text-sm font-medium text-muted">Instructions</label>
            <textarea
              id={instructionsFieldId}
              className="mt-1 block min-h-28 w-full rounded border border-border px-3 py-2"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={expectedInputFieldId} className="text-sm font-medium text-muted">Expected input</label>
              <select
                id={expectedInputFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2"
                value={expectedInputType}
                onChange={(event) => setExpectedInputType(event.target.value as ExpectedInputType)}
              >
                <option value="text">text</option>
                <option value="boolean">boolean</option>
                <option value="enum">enum</option>
                <option value="number">number</option>
                <option value="photo">photo</option>
              </select>
            </div>
            <div>
              <label htmlFor={safetyFieldId} className="text-sm font-medium text-muted">Safety level</label>
              <select
                id={safetyFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2"
                value={safetyLevel}
                onChange={(event) => setSafetyLevel(event.target.value as ActionSafetyLevel)}
              >
                {ACTION_SAFETY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {expectedInputType === "number" ? (
              <div>
                <label htmlFor={unitFieldId} className="text-sm font-medium text-muted">Unit</label>
                <input
                  id={unitFieldId}
                  className="mt-1 block w-full rounded border border-border px-3 py-2"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor={appliesToModelsFieldId} className="text-sm font-medium text-muted">Applies to models</label>
              <input
                id={appliesToModelsFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2"
                value={appliesToModels}
                onChange={(event) => setAppliesToModels(event.target.value)}
                placeholder="Comma-separated model numbers"
              />
            </div>
          </div>
          {expectedInputType === "number" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor={rangeMinFieldId} className="text-sm font-medium text-muted">Range min</label>
                <input
                  id={rangeMinFieldId}
                  className="mt-1 block w-full rounded border border-border px-3 py-2"
                  value={rangeMin}
                  onChange={(event) => setRangeMin(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor={rangeMaxFieldId} className="text-sm font-medium text-muted">Range max</label>
                <input
                  id={rangeMaxFieldId}
                  className="mt-1 block w-full rounded border border-border px-3 py-2"
                  value={rangeMax}
                  onChange={(event) => setRangeMax(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          {(expectedInputType === "enum" || expectedInputType === "boolean") ? (
            <div>
              <label htmlFor={optionsFieldId} className="text-sm font-medium text-muted">Options (one per line)</label>
              <textarea
                id={optionsFieldId}
                className="mt-1 block min-h-24 w-full rounded border border-border px-3 py-2"
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
              />
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : mode === "create" ? "Create action" : "Save action"}
            </button>
          </div>
        </div>
      </ModalSection>
    </Modal>
  );
}

export function LabelQuickEditModal({
  open,
  mode,
  label,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  label: EditorLabelOption | null;
  onClose: () => void;
  onSaved: (label: EditorLabelOption) => void;
}) {
  const idFieldId = useId();
  const displayNameFieldId = useId();
  const descriptionFieldId = useId();
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!open) return;
    if (mode === "edit" && label) {
      setId(label.id);
      setDisplayName(label.displayName);
      setDescription(label.description ?? "");
      return;
    }
    setId("");
    setDisplayName("");
    setDescription("");
  }, [label, mode, open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(mode === "create" ? "/api/admin/labels" : `/api/admin/labels/${label?.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "create" ? { id } : {}),
          displayName,
          description,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Failed to save label.");
        return;
      }
      onSaved(data);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalSection title={mode === "create" ? "Create label" : `Edit label: ${label?.displayName ?? ""}`}>
        <div className="space-y-4">
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          {mode === "create" ? (
            <div>
              <label htmlFor={idFieldId} className="text-sm font-medium text-muted">Label ID</label>
              <input
                id={idFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2"
                value={id}
                onChange={(event) => setId(event.target.value)}
              />
            </div>
          ) : null}
          <div>
            <label htmlFor={displayNameFieldId} className="text-sm font-medium text-muted">Display name</label>
            <input
              id={displayNameFieldId}
              className="mt-1 block w-full rounded border border-border px-3 py-2"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={descriptionFieldId} className="text-sm font-medium text-muted">Description</label>
            <textarea
              id={descriptionFieldId}
              className="mt-1 block min-h-24 w-full rounded border border-border px-3 py-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded border border-border px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : mode === "create" ? "Create label" : "Save label"}
            </button>
          </div>
        </div>
      </ModalSection>
    </Modal>
  );
}

function ValueDefinitionSummary({
  expectedInput,
  valueDefinition,
}: {
  expectedInput?: ExpectedInput | null;
  valueDefinition?: EvidenceValueDefinition;
}) {
  const lines = expectedInput ? formatExpectedInputSummary(expectedInput) : [];
  if (!expectedInput && !valueDefinition) return null;
  return (
    <div className="rounded border border-border bg-page px-3 py-3 text-sm">
      <p className="font-medium text-ink">
        {expectedInput ? "Synced value contract" : "Effective value contract"}
      </p>
      <ul className="mt-2 space-y-1 text-muted">
        {expectedInput
          ? lines.map((line) => <li key={line}>{line}</li>)
          : [
              valueDefinition?.kind ? `Kind: ${valueDefinition.kind}` : null,
              valueDefinition?.unit ? `Unit: ${valueDefinition.unit}` : null,
              valueDefinition?.options?.length ? `Options: ${valueDefinition.options.join(", ")}` : null,
              valueDefinition?.unknownValues?.length ? `Unknown values: ${valueDefinition.unknownValues.join(", ")}` : null,
              valueDefinition?.notes ? `Notes: ${valueDefinition.notes}` : null,
            ]
              .filter(Boolean)
              .map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  );
}

export function ValueDefinitionEditor({
  evidenceItem,
  actionsById,
  onChange,
  issues,
}: {
  evidenceItem: EvidenceItem;
  actionsById: Map<string, EditorActionOption>;
  onChange: (valueDefinition: EvidenceValueDefinition | undefined) => void;
  issues?: string[];
}) {
  const kindFieldId = useId();
  const unitFieldId = useId();
  const optionsFieldId = useId();
  const unknownValuesFieldId = useId();
  const notesFieldId = useId();
  const linkedAction = evidenceItem.actionId ? actionsById.get(evidenceItem.actionId) : undefined;
  const effectiveValueDefinition = getEffectiveValueDefinition(evidenceItem, actionsById);
  const valueDefinition = evidenceItem.valueDefinition ?? { kind: "text" as const };

  if (linkedAction) {
    return (
      <div className="space-y-2">
        <ValueDefinitionSummary
          expectedInput={linkedAction.expectedInput}
          valueDefinition={effectiveValueDefinition}
        />
        <p className="text-xs text-muted">
          This evidence is linked to <span className="font-medium text-ink">{linkedAction.title}</span> ({linkedAction.id}). Edit the action to change its value contract.
        </p>
        <InlineIssues issues={issues} />
      </div>
    );
  }

  return (
    <div className="rounded border border-border p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={kindFieldId} className="text-xs font-medium text-muted">Value kind</label>
          <select
            id={kindFieldId}
            className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
            value={valueDefinition.kind ?? "text"}
            onChange={(event) =>
              onChange({
                ...valueDefinition,
                kind: event.target.value as EvidenceValueDefinition["kind"],
              })
            }
          >
            {VALUE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
        {valueDefinition.kind === "number" ? (
          <div>
            <label htmlFor={unitFieldId} className="text-xs font-medium text-muted">Unit</label>
            <input
              id={unitFieldId}
              className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
              value={valueDefinition.unit ?? ""}
              onChange={(event) => onChange({ ...valueDefinition, unit: event.target.value })}
            />
          </div>
        ) : null}
      </div>
      {(valueDefinition.kind === "enum" || valueDefinition.kind === "boolean") ? (
        <div className="mt-3">
          <label htmlFor={optionsFieldId} className="text-xs font-medium text-muted">Options (one per line)</label>
          <textarea
            id={optionsFieldId}
            className="mt-1 block min-h-20 w-full rounded border border-border px-3 py-2 text-sm"
            value={(valueDefinition.options ?? []).join("\n")}
            onChange={(event) => onChange({ ...valueDefinition, options: parseLines(event.target.value) })}
          />
        </div>
      ) : null}
      <div className="mt-3">
        <label htmlFor={unknownValuesFieldId} className="text-xs font-medium text-muted">Unknown values (one per line)</label>
        <textarea
          id={unknownValuesFieldId}
          className="mt-1 block min-h-16 w-full rounded border border-border px-3 py-2 text-sm"
          value={(valueDefinition.unknownValues ?? []).join("\n")}
          onChange={(event) => onChange({ ...valueDefinition, unknownValues: parseLines(event.target.value) })}
        />
      </div>
      <div className="mt-3">
        <label htmlFor={notesFieldId} className="text-xs font-medium text-muted">Notes</label>
        <textarea
          id={notesFieldId}
          className="mt-1 block min-h-16 w-full rounded border border-border px-3 py-2 text-sm"
          value={valueDefinition.notes ?? ""}
          onChange={(event) => onChange({ ...valueDefinition, notes: event.target.value })}
        />
      </div>
      <InlineIssues issues={issues} />
    </div>
  );
}

function RuleRow({
  rule,
  evidenceChecklist,
  actionsById,
  onChange,
  onRemove,
  issues,
}: {
  rule: EvidenceRuleType;
  evidenceChecklist: EvidenceItem[];
  actionsById: Map<string, EditorActionOption>;
  onChange: (rule: EvidenceRuleType) => void;
  onRemove: () => void;
  issues?: string[];
}) {
  const operatorFieldId = useId();
  const minFieldId = useId();
  const maxFieldId = useId();
  const valuesFieldId = useId();
  const rationaleFieldId = useId();
  const evidence = evidenceChecklist.find((item) => item.id === rule.evidenceId);
  const valueDefinition = evidence ? getEffectiveValueDefinition(evidence, actionsById) : undefined;
  const allowedOperators = getAllowedRuleOperators(valueDefinition);
  const selectedOperator = allowedOperators.includes(rule.operator ?? "equals")
    ? (rule.operator ?? allowedOperators[0] ?? "equals")
    : (allowedOperators[0] ?? "equals");
  const selectableValues = getRuleSelectableValues(valueDefinition);
  const evidenceOptions: SearchableOption[] = evidenceChecklist.map((item) => ({
    value: item.id,
    label: item.id,
    description: item.description,
  }));
  const summaryValue =
    selectedOperator === "between" || selectedOperator === "not_between"
      ? typeof rule.min === "number" && typeof rule.max === "number"
        ? `${rule.min} to ${rule.max}`
        : "Range pending"
      : selectedOperator === "exists" || selectedOperator === "missing"
        ? "No value required"
        : rule.values && rule.values.length > 0
          ? selectedOperator === "equals" || selectedOperator === "not_equals"
            ? String(rule.values[0])
            : `${rule.values.length} selected`
          : "No values selected";

  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-page px-3 py-2 text-xs text-muted">
        <Badge variant="default">{evidence?.id || "No evidence"}</Badge>
        <span className="font-medium text-ink">{selectedOperator}</span>
        <span>{summaryValue}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        <SearchableSelect
          label="Evidence"
          value={rule.evidenceId}
          onChange={(evidenceId) => onChange({ ...rule, evidenceId })}
          options={evidenceOptions}
          placeholder="Filter evidence"
          allowEmpty
          emptyLabel="Select evidence"
        />
        <div>
          <label htmlFor={operatorFieldId} className="text-xs font-medium text-muted">Operator</label>
          <select
            id={operatorFieldId}
            className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
            value={selectedOperator}
            onChange={(event) =>
              onChange({
                evidenceId: rule.evidenceId,
                operator: event.target.value as EvidenceRule["operator"],
                rationale: rule.rationale,
              })
            }
          >
            {allowedOperators.map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedOperator === "between" || selectedOperator === "not_between" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={minFieldId} className="text-xs font-medium text-muted">Min</label>
            <input
              id={minFieldId}
              type="number"
              className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
              value={typeof rule.min === "number" ? String(rule.min) : ""}
              onChange={(event) =>
                onChange({
                  ...rule,
                  min: event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
          <div>
            <label htmlFor={maxFieldId} className="text-xs font-medium text-muted">Max</label>
            <input
              id={maxFieldId}
              type="number"
              className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
              value={typeof rule.max === "number" ? String(rule.max) : ""}
              onChange={(event) =>
                onChange({
                  ...rule,
                  max: event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
        </div>
      ) : selectedOperator !== "exists" && selectedOperator !== "missing" ? (
        <div className="mt-3">
          <label htmlFor={valuesFieldId} className="text-xs font-medium text-muted">
            {selectedOperator === "equals" || selectedOperator === "not_equals" ? "Value" : "Values"}
          </label>
          {selectableValues.length > 0 ? (
            <select
              id={valuesFieldId}
              multiple={selectedOperator === "in" || selectedOperator === "not_in"}
              className="mt-1 block min-h-24 w-full rounded border border-border px-3 py-2 text-sm"
              value={
                selectedOperator === "in" || selectedOperator === "not_in"
                  ? (rule.values ?? [])
                  : (rule.values?.[0] ?? "")
              }
              onChange={(event) =>
                onChange({
                  ...rule,
                  values:
                    selectedOperator === "in" || selectedOperator === "not_in"
                      ? Array.from(event.target.selectedOptions).map((option) => option.value)
                      : [event.target.value],
                })
              }
            >
              {selectableValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              id={valuesFieldId}
              className="mt-1 block min-h-20 w-full rounded border border-border px-3 py-2 text-sm"
              value={(rule.values ?? []).join("\n")}
              onChange={(event) => onChange({ ...rule, values: parseLines(event.target.value) })}
              placeholder={
                selectedOperator === "equals" || selectedOperator === "not_equals"
                  ? "One value"
                  : "One value per line"
              }
            />
          )}
        </div>
      ) : null}

      <div className="mt-3">
        <label htmlFor={rationaleFieldId} className="text-xs font-medium text-muted">Rationale (optional)</label>
        <input
          id={rationaleFieldId}
          className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
          value={rule.rationale ?? ""}
          onChange={(event) => onChange({ ...rule, rationale: event.target.value })}
        />
      </div>
      <InlineIssues issues={issues} />
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={onRemove} className="text-sm text-red-600">
          Remove rule
        </button>
      </div>
    </div>
  );
}

export function CauseRuleBuilder({
  label,
  rules,
  evidenceChecklist,
  actionsById,
  onChange,
  issuesByIndex,
  tone = "neutral",
  helperText,
}: {
  label: string;
  rules: EvidenceRule[];
  evidenceChecklist: EvidenceItem[];
  actionsById: Map<string, EditorActionOption>;
  onChange: (rules: EvidenceRule[]) => void;
  issuesByIndex?: Record<number, string[]>;
  tone?: "neutral" | "support" | "exclude";
  helperText?: string;
}) {
  const ruleRefs = useRef<Array<HTMLDivElement | null>>([]);
  const previousRuleCountRef = useRef(rules.length);

  useEffect(() => {
    if (rules.length > previousRuleCountRef.current) {
      const target = ruleRefs.current[rules.length - 1];
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    previousRuleCountRef.current = rules.length;
  }, [rules]);

  return (
    <CauseSectionCard
      title={label}
      count={rules.length}
      tone={tone}
      helper={helperText}
      testId={`cause-rule-section-${tone}`}
      actions={
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rules,
              {
                evidenceId: "",
                operator: "equals",
                values: [],
              },
            ])
          }
          className="text-sm font-medium text-primary"
        >
          Add rule
        </button>
      }
    >
      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-4 text-sm text-muted">
            {label === "Exclude rules" ? "No exclude rules yet." : "No support rules yet."}
          </div>
        ) : null}
        {rules.map((rule, index) => (
          <div
            key={`${rule.evidenceId}-${index}`}
            ref={(node) => {
              ruleRefs.current[index] = node;
            }}
          >
            <RuleRow
              rule={rule}
              evidenceChecklist={evidenceChecklist}
              actionsById={actionsById}
              issues={issuesByIndex?.[index]}
              onChange={(nextRule) =>
                onChange(rules.map((item, itemIndex) => (itemIndex === index ? nextRule : item)))
              }
              onRemove={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}
            />
          </div>
        ))}
      </div>
    </CauseSectionCard>
  );
}

export function CauseEditor({
  cause,
  evidenceChecklist,
  actionsById,
  onChange,
  issues,
  autoFocusCauseId = false,
}: {
  cause: CauseItem;
  evidenceChecklist: EvidenceItem[];
  actionsById: Map<string, EditorActionOption>;
  onChange: (cause: CauseItem) => void;
  issues?: Partial<Record<string, string[]>>;
  autoFocusCauseId?: boolean;
}) {
  const causeIdFieldId = useId();
  const likelihoodFieldId = useId();
  const outcomeFieldId = useId();
  const supportModeFieldId = useId();
  const causeDescriptionFieldId = useId();
  const rulingEvidenceFilterFieldId = useId();
  const [rulingEvidenceFilter, setRulingEvidenceFilter] = useState("");
  const filteredEvidence = useMemo(() => {
    const pattern = rulingEvidenceFilter.trim().toLowerCase();
    if (!pattern) return evidenceChecklist;
    return evidenceChecklist.filter(
      (item) =>
        item.id.toLowerCase().includes(pattern) ||
        item.description.toLowerCase().includes(pattern)
    );
  }, [evidenceChecklist, rulingEvidenceFilter]);

  const supportRuleIssues = useMemo(() => {
    const next: Record<number, string[]> = {};
    Object.entries(issues ?? {}).forEach(([path, messages]) => {
      const match = path.match(/^supportRules\.(\d+)/);
      if (match) next[Number(match[1])] = messages ?? [];
    });
    return next;
  }, [issues]);

  const excludeRuleIssues = useMemo(() => {
    const next: Record<number, string[]> = {};
    Object.entries(issues ?? {}).forEach(([path, messages]) => {
      const match = path.match(/^excludeRules\.(\d+)/);
      if (match) next[Number(match[1])] = messages ?? [];
    });
    return next;
  }, [issues]);

  return (
    <div className="space-y-4">
      <CauseSectionCard
        title="Cause details"
        helper="Define the cause metadata and a short plain-language description."
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor={causeIdFieldId} className="text-xs font-medium text-muted">Cause ID</label>
              <input
                id={causeIdFieldId}
                autoFocus={autoFocusCauseId}
                className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                value={cause.id}
                onChange={(event) => onChange({ ...cause, id: event.target.value })}
              />
              <InlineIssues issues={issues?.id} />
            </div>
            <div>
              <label htmlFor={likelihoodFieldId} className="text-xs font-medium text-muted">Likelihood</label>
              <select
                id={likelihoodFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                value={cause.likelihood}
                onChange={(event) => onChange({ ...cause, likelihood: event.target.value as CauseItem["likelihood"] })}
              >
                {LIKELIHOODS.map((likelihood) => (
                  <option key={likelihood} value={likelihood}>
                    {likelihood}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={outcomeFieldId} className="text-xs font-medium text-muted">Outcome</label>
              <select
                id={outcomeFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                value={cause.outcome ?? "resolution"}
                onChange={(event) => onChange({ ...cause, outcome: event.target.value as CauseItem["outcome"] })}
              >
                {CAUSE_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={supportModeFieldId} className="text-xs font-medium text-muted">Support mode</label>
              <select
                id={supportModeFieldId}
                className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                value={cause.supportMode ?? "all"}
                onChange={(event) => onChange({ ...cause, supportMode: event.target.value as CauseItem["supportMode"] })}
              >
                {RULE_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={causeDescriptionFieldId} className="text-xs font-medium text-muted">Cause description</label>
            <textarea
              id={causeDescriptionFieldId}
              className="mt-1 block min-h-24 w-full rounded border border-border px-3 py-2 text-sm"
              value={cause.cause}
              onChange={(event) => onChange({ ...cause, cause: event.target.value })}
            />
            <InlineIssues issues={issues?.cause} />
          </div>
        </div>
      </CauseSectionCard>
      <CauseSectionCard
        title="Ruling evidence"
        count={cause.rulingEvidence.length}
        helper="Mark the evidence items this cause depends on so the assistant and verifier stay aligned."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {cause.rulingEvidence.length > 0 ? (
                cause.rulingEvidence.map((evidenceId) => (
                  <Badge key={evidenceId} variant="info">
                    {evidenceId}
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-muted">No ruling evidence selected yet.</p>
              )}
            </div>
            <input
              id={rulingEvidenceFilterFieldId}
              className="w-full max-w-sm rounded border border-border px-3 py-2 text-sm"
              placeholder="Filter evidence"
              value={rulingEvidenceFilter}
              onChange={(event) => setRulingEvidenceFilter(event.target.value)}
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {filteredEvidence.map((item) => {
              const checked = cause.rulingEvidence.includes(item.id);
              return (
                <label key={item.id} className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      onChange({
                        ...cause,
                        rulingEvidence: event.target.checked
                          ? [...cause.rulingEvidence, item.id]
                          : cause.rulingEvidence.filter((evidenceId) => evidenceId !== item.id),
                      })
                    }
                  />
                  <span>
                    <span className="font-medium text-ink">{item.id}</span>
                    <span className="block text-muted">{item.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <InlineIssues issues={issues?.rulingEvidence} />
        </div>
      </CauseSectionCard>
      <CauseRuleBuilder
        label="Support rules"
        rules={cause.supportRules ?? []}
        evidenceChecklist={evidenceChecklist}
        actionsById={actionsById}
        issuesByIndex={supportRuleIssues}
        tone="support"
        helperText="These conditions should support selecting this cause."
        onChange={(supportRules) => onChange({ ...cause, supportRules })}
      />
      <CauseRuleBuilder
        label="Exclude rules"
        rules={cause.excludeRules ?? []}
        evidenceChecklist={evidenceChecklist}
        actionsById={actionsById}
        issuesByIndex={excludeRuleIssues}
        tone="exclude"
        helperText="These conditions should rule this cause out even if other evidence overlaps."
        onChange={(excludeRules) => onChange({ ...cause, excludeRules })}
      />
    </div>
  );
}

export { InlineIssues, SearchableSelect, ValueDefinitionSummary };
