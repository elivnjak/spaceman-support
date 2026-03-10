"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type Ref, type SetStateAction } from "react";
import { Badge } from "@/components/ui/Badge";
import { TAB_HELP } from "./playbook-help-content";
import {
  CauseEditor,
  SearchableSelect,
  InlineIssues,
  ValueDefinitionEditor,
  type EditorActionOption,
  type EditorLabelOption,
} from "./V2EditorControls";
import { EVIDENCE_TYPES, type CauseItem, type EvidenceItem } from "@/lib/playbooks/schema";
import type {
  Action,
  Playbook,
  PlaybookFormState,
  PlaybookTab,
  ProductTypeOption,
  Step,
} from "./types";

function IconButton({
  label,
  onClick,
  disabled = false,
  tone = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const className =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : "border-border bg-surface text-ink hover:bg-aqua/30";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  const rotateClass = direction === "up" ? "rotate-180" : "";
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`h-4 w-4 ${rotateClass}`}>
      <path
        d="M5.5 7.5 10 12l4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "up" | "down" }) {
  const rotateClass = direction === "up" ? "" : "rotate-180";
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={`h-4 w-4 ${rotateClass}`}>
      <path
        d="M10 15V5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="m6.5 8.5 3.5-3.5 3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6.5 6.5v8m3.5-8v8m3.5-8v8M4.5 5.5h11m-8-2h5m-7 2 .5 10a1 1 0 0 0 1 .95h6a1 1 0 0 0 1-.95l.5-10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function moveItem<T>(items: T[], from: number, direction: -1 | 1): T[] {
  const target = from + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

function TabHelpBlock({
  tab,
  expanded,
  onToggle,
}: {
  tab: PlaybookTab;
  expanded: boolean;
  onToggle: () => void;
}) {
  const help = TAB_HELP[tab];
  if (!help) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary/80 transition-colors hover:text-primary"
      >
        {expanded ? "Hide guide" : "Show guide"}
      </button>
      {expanded ? (
        <div className="mt-2 rounded-lg border border-primary/20 bg-primary-light px-4 py-3 text-sm text-ink">
          {help.body}
        </div>
      ) : null}
    </div>
  );
}

function PanelCard({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded border border-border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

function buildIssueDictionary(messages: string[]) {
  return messages.length > 0 ? messages : undefined;
}

function getCauseSummary(cause: CauseItem): string {
  const firstLine = cause.cause.split("\n")[0]?.trim();
  if (firstLine) return firstLine;
  if (cause.id.trim()) return cause.id.trim();
  return "New cause";
}

function CauseAccordionCard({
  cause,
  index,
  isExpanded,
  onToggleExpand,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
  children,
  containerRef,
}: {
  cause: CauseItem;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  children: ReactNode;
  containerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={containerRef} className="overflow-hidden rounded-2xl border-2 border-border bg-surface shadow-sm">
      <div className={isExpanded ? "border-b border-border bg-page/90" : "bg-page/70"}>
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{cause.id || `Cause ${index + 1}`}</span>
                <Badge variant={cause.likelihood === "high" ? "warning" : cause.likelihood === "medium" ? "info" : "default"}>
                  {cause.likelihood}
                </Badge>
                <Badge variant={cause.outcome === "escalation" ? "danger" : "success"}>
                  {cause.outcome ?? "resolution"}
                </Badge>
                <Badge variant="default">{cause.supportMode ?? "all"}</Badge>
              </div>
              <p className="mt-2 text-sm text-ink">{getCauseSummary(cause)}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="default">{cause.rulingEvidence.length} ruling evidence</Badge>
                <Badge variant="success">{cause.supportRules?.length ?? 0} support rules</Badge>
                <Badge variant="warning">{cause.excludeRules?.length ?? 0} exclude rules</Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <IconButton
                label={`Move ${cause.id || `cause ${index + 1}`} up`}
                onClick={() => onMove(-1)}
                disabled={!canMoveUp}
              >
                <ArrowIcon direction="up" />
              </IconButton>
              <IconButton
                label={`Move ${cause.id || `cause ${index + 1}`} down`}
                onClick={() => onMove(1)}
                disabled={!canMoveDown}
              >
                <ArrowIcon direction="down" />
              </IconButton>
              <IconButton
                label={`Remove ${cause.id || `cause ${index + 1}`}`}
                onClick={onRemove}
                tone="danger"
              >
                <TrashIcon />
              </IconButton>
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-controls={`cause-panel-${index}`}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm font-medium text-ink hover:bg-aqua/30"
            >
              <span>{isExpanded ? "Collapse cause details" : "Expand cause details"}</span>
              <ChevronIcon direction={isExpanded ? "up" : "down"} />
            </button>
          </div>
        </div>
      </div>
      {isExpanded ? (
        <div id={`cause-panel-${index}`} className="bg-surface px-4 py-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function formatValidationIssueSummary(
  path: string,
  form: PlaybookFormState
): string {
  if (path === "labelId") return "Label";
  if (path === "title") return "Title";
  const evidenceMatch = path.match(/^evidenceChecklist\.(\d+)(?:\.(.+))?/);
  if (evidenceMatch) {
    const evidence = form.evidenceChecklist[Number(evidenceMatch[1])];
    const suffix = evidenceMatch[2] ? ` -> ${evidenceMatch[2]}` : "";
    return `Evidence "${evidence?.id || evidence?.description || `#${Number(evidenceMatch[1]) + 1}`}"${suffix}`;
  }
  const causeMatch = path.match(/^candidateCauses\.(\d+)(?:\.(.+))?/);
  if (causeMatch) {
    const cause = form.candidateCauses[Number(causeMatch[1])];
    const suffix = causeMatch[2] ? ` -> ${causeMatch[2]}` : "";
    return `Cause "${cause?.id || cause?.cause || `#${Number(causeMatch[1]) + 1}`}"${suffix}`;
  }
  return path;
}

export function PlaybookEditorPanel({
  editing,
  form,
  setForm,
  activeTab,
  setActiveTab,
  labels,
  productTypes,
  actionsList,
  actionsById,
  helpExpanded,
  toggleHelp,
  showSchemaVersion,
  getIssuesForPrefix,
  onOpenCreateActionModal,
  onOpenEditActionModal,
  onOpenCreateLabelModal,
  onOpenEditLabelModal,
  onSave,
  onCancel,
  saving,
  savedFeedback,
}: {
  editing: Playbook | null;
  form: PlaybookFormState;
  setForm: Dispatch<SetStateAction<PlaybookFormState>>;
  activeTab: PlaybookTab;
  setActiveTab: (tab: PlaybookTab) => void;
  labels: EditorLabelOption[];
  productTypes: ProductTypeOption[];
  actionsList: Action[];
  actionsById: Map<string, EditorActionOption>;
  helpExpanded: boolean;
  toggleHelp: () => void;
  showSchemaVersion: boolean;
  getIssuesForPrefix: (prefix: string) => string[];
  onOpenCreateActionModal: (evidenceIndex?: number) => void;
  onOpenEditActionModal: (actionId?: string, evidenceIndex?: number) => void;
  onOpenCreateLabelModal: () => void;
  onOpenEditLabelModal: (labelId?: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  savedFeedback: boolean;
}) {
  const labelOptions = useMemo(
    () =>
      labels.map((label) => ({
        value: label.id,
        label: label.displayName,
        description: label.description,
      })),
    [labels]
  );
  const actionOptions = useMemo(
    () =>
      actionsList.map((action) => ({
        value: action.id,
        label: action.title,
        description: action.instructions,
      })),
    [actionsList]
  );
  const [expandedCauseIndex, setExpandedCauseIndex] = useState<number | null>(
    form.candidateCauses.length > 0 ? 0 : null
  );
  const causeCardRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (activeTab !== "causes") return;
    if (form.candidateCauses.length === 0) {
      setExpandedCauseIndex(null);
      return;
    }
    setExpandedCauseIndex((current) => {
      if (current == null || current >= form.candidateCauses.length) {
        return form.candidateCauses.length - 1;
      }
      return current;
    });
  }, [activeTab, form.candidateCauses.length]);

  useEffect(() => {
    if (activeTab !== "causes" || expandedCauseIndex == null) return;
    const target = causeCardRefs.current[expandedCauseIndex];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeTab, expandedCauseIndex]);

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="mb-4 flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{editing ? "Edit playbook" : "Create playbook"}</h2>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            onClick={() => setForm((current) => ({ ...current, enabled: !current.enabled }))}
            className={`flex items-center gap-2.5 rounded-full border py-1.5 pl-3 pr-1.5 text-sm font-medium transition-colors ${
              form.enabled
                ? "border-green-300 bg-green-50 text-green-800"
                : "border-gray-300 bg-gray-50 text-gray-600"
            }`}
          >
            {form.enabled ? "Enabled" : "Disabled"}
            <span
              className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
                form.enabled ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  form.enabled ? "translate-x-[22px]" : "translate-x-[3px]"
                }`}
              />
            </span>
          </button>
        </div>
        {showSchemaVersion && editing?.schemaVersion != null ? (
          <p className="text-xs text-muted">Schema version: {editing.schemaVersion}</p>
        ) : null}
      </div>

      <div
        className={`mb-5 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
          form.enabled
            ? "border border-green-200 bg-green-50 text-green-800"
            : "border border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        <span className="font-medium">{form.enabled ? "Enabled" : "Disabled"}</span>
        <span className="text-xs opacity-75">
          {form.enabled
            ? "— this playbook will be used in diagnosis triage"
            : "— this playbook is excluded from diagnosis triage"}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-border">
        {(["overview", "symptoms", "evidence", "causes", "triggers", "steps"] as PlaybookTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded px-3 py-1.5 text-sm ${activeTab === tab ? "bg-primary text-white" : "bg-page"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div>
          <TabHelpBlock tab="overview" expanded={helpExpanded} onToggle={toggleHelp} />
          <PanelCard title="Core playbook details">
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <div>
                <SearchableSelect
                  label="Label"
                  value={form.labelId}
                  onChange={(labelId) => setForm((current) => ({ ...current, labelId }))}
                  options={labelOptions}
                  placeholder="Search labels"
                />
                <InlineIssues issues={buildIssueDictionary(getIssuesForPrefix("labelId"))} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onOpenCreateLabelModal}
                    className="rounded border border-border px-3 py-1 text-xs text-primary"
                  >
                    New label
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEditLabelModal(form.labelId)}
                    disabled={!form.labelId}
                    className="rounded border border-border px-3 py-1 text-xs text-primary disabled:opacity-50"
                  >
                    Edit selected label
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted">Title</label>
                <input
                  type="text"
                  className="mt-1 block w-full rounded border border-border px-3 py-2"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. Fix too runny"
                />
                <InlineIssues issues={buildIssueDictionary(getIssuesForPrefix("title"))} />
              </div>
            </div>
            <div className="mt-4 rounded border border-border p-3">
              <p className="text-sm font-medium text-ink">Applicable product types</p>
              <p className="mt-1 text-xs text-muted">Leave empty to apply to all product types.</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {productTypes.map((productType) => {
                  const checked = form.productTypeIds.includes(productType.id);
                  return (
                    <label key={productType.id} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            productTypeIds: event.target.checked
                              ? [...current.productTypeIds, productType.id]
                              : current.productTypeIds.filter((id) => id !== productType.id),
                          }))
                        }
                      />
                      {productType.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "symptoms" ? (
        <div>
          <TabHelpBlock tab="symptoms" expanded={helpExpanded} onToggle={toggleHelp} />
          <PanelCard
            title="Symptoms"
            actions={
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    symptoms: [...current.symptoms, { id: "", description: "" }],
                  }))
                }
                className="text-sm text-primary"
              >
                Add symptom
              </button>
            }
          >
            <div className="space-y-3">
              {form.symptoms.map((symptom, index) => (
                <div key={`${symptom.id}-${index}`} className="rounded border border-border p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                    <div>
                      <label className="text-xs font-medium text-muted">ID</label>
                      <input
                        className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                        value={symptom.id}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            symptoms: current.symptoms.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, id: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted">Description</label>
                      <input
                        className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                        value={symptom.description}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            symptoms: current.symptoms.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, description: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            symptoms: moveItem(current.symptoms, index, -1),
                          }))
                        }
                        disabled={index === 0}
                        className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            symptoms: moveItem(current.symptoms, index, 1),
                          }))
                        }
                        disabled={index === form.symptoms.length - 1}
                        className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            symptoms: current.symptoms.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                        className="text-sm text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {form.symptoms.length === 0 ? <p className="text-sm text-muted">No symptoms yet.</p> : null}
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "evidence" ? (
        <div>
          <TabHelpBlock tab="evidence" expanded={helpExpanded} onToggle={toggleHelp} />
          <PanelCard
            title="Evidence checklist"
            actions={
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    evidenceChecklist: [
                      ...current.evidenceChecklist,
                      { id: "", description: "", type: "observation", required: false },
                    ],
                  }))
                }
                className="text-sm text-primary"
              >
                Add evidence
              </button>
            }
          >
            <div className="space-y-4">
              {form.evidenceChecklist.map((item, index) => {
                const actionId = item.actionId ?? "";
                const itemPrefix = `evidenceChecklist.${index}`;
                return (
                  <div key={`${item.id}-${index}`} className="rounded border border-border p-3">
                    <div className="mb-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <div>
                        <label className="text-xs font-medium text-muted">Evidence ID</label>
                        <input
                          className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                          value={item.id}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              evidenceChecklist: current.evidenceChecklist.map((entry, itemIndex) =>
                                itemIndex === index ? { ...entry, id: event.target.value } : entry
                              ),
                            }))
                          }
                        />
                        <InlineIssues issues={getIssuesForPrefix(`${itemPrefix}.id`)} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted">Type</label>
                        <select
                          className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                          value={item.type}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              evidenceChecklist: current.evidenceChecklist.map((entry, itemIndex) =>
                                itemIndex === index
                                  ? { ...entry, type: event.target.value as EvidenceItem["type"] }
                                  : entry
                              ),
                            }))
                          }
                        >
                          {EVIDENCE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={item.required}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                evidenceChecklist: current.evidenceChecklist.map((entry, itemIndex) =>
                                  itemIndex === index ? { ...entry, required: event.target.checked } : entry
                                ),
                              }))
                            }
                          />
                          Required
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              evidenceChecklist: moveItem(current.evidenceChecklist, index, -1),
                            }))
                          }
                          disabled={index === 0}
                          className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              evidenceChecklist: moveItem(current.evidenceChecklist, index, 1),
                            }))
                          }
                          disabled={index === form.evidenceChecklist.length - 1}
                          className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              evidenceChecklist: current.evidenceChecklist.filter((_, itemIndex) => itemIndex !== index),
                            }))
                          }
                          className="text-sm text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="text-xs font-medium text-muted">Description</label>
                      <input
                        className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                        value={item.description}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            evidenceChecklist: current.evidenceChecklist.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, description: event.target.value } : entry
                            ),
                          }))
                        }
                      />
                      <InlineIssues issues={getIssuesForPrefix(`${itemPrefix}.description`)} />
                    </div>
                    <div className="grid gap-3 xl:grid-cols-[1.5fr_auto]">
                      <div>
                        <SearchableSelect
                          label="Linked action"
                          value={actionId}
                          onChange={(nextActionId) =>
                            setForm((current) => ({
                              ...current,
                              evidenceChecklist: current.evidenceChecklist.map((entry, itemIndex) =>
                                itemIndex === index ? { ...entry, actionId: nextActionId || undefined } : entry
                              ),
                            }))
                          }
                          allowEmpty
                          emptyLabel="No action"
                          options={actionOptions}
                          placeholder="Search actions"
                        />
                        <InlineIssues issues={getIssuesForPrefix(`${itemPrefix}.actionId`)} />
                      </div>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenCreateActionModal(index)}
                          className="rounded border border-border px-3 py-2 text-sm text-primary"
                        >
                          New action
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenEditActionModal(item.actionId, index)}
                          disabled={!item.actionId}
                          className="rounded border border-border px-3 py-2 text-sm text-primary disabled:opacity-50"
                        >
                          Edit action
                        </button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <ValueDefinitionEditor
                        evidenceItem={item}
                        actionsById={actionsById}
                        issues={getIssuesForPrefix(`${itemPrefix}.valueDefinition`)}
                        onChange={(valueDefinition) =>
                          setForm((current) => ({
                            ...current,
                            evidenceChecklist: current.evidenceChecklist.map((entry, itemIndex) =>
                              itemIndex === index ? { ...entry, valueDefinition } : entry
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })}
              {form.evidenceChecklist.length === 0 ? <p className="text-sm text-muted">No evidence yet.</p> : null}
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "causes" ? (
        <div>
          <TabHelpBlock tab="causes" expanded={helpExpanded} onToggle={toggleHelp} />
          <PanelCard
            title="Candidate causes"
            actions={
              <button
                type="button"
                onClick={() => {
                  const nextIndex = form.candidateCauses.length;
                  setExpandedCauseIndex(nextIndex);
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
                      } as CauseItem,
                    ],
                  }));
                }}
                className="text-sm text-primary"
              >
                Add cause
              </button>
            }
          >
            <div className="space-y-4">
              {form.candidateCauses.map((cause, index) => {
                const prefix = `candidateCauses.${index}`;
                const causeIssues = {
                  id: getIssuesForPrefix(`${prefix}.id`),
                  cause: getIssuesForPrefix(`${prefix}.cause`),
                  rulingEvidence: getIssuesForPrefix(`${prefix}.rulingEvidence`),
                  ...Object.fromEntries(
                    ["supportRules", "excludeRules"].flatMap((ruleType) =>
                      cause[ruleType as "supportRules" | "excludeRules"]?.map((_, ruleIndex) => [
                        `${ruleType}.${ruleIndex}`,
                        getIssuesForPrefix(`${prefix}.${ruleType}.${ruleIndex}`),
                      ]) ?? []
                    )
                  ),
                };
                return (
                  <CauseAccordionCard
                    key={`${cause.id}-${index}`}
                    cause={cause}
                    index={index}
                    containerRef={(node) => {
                      causeCardRefs.current[index] = node;
                    }}
                    isExpanded={expandedCauseIndex === index}
                    onToggleExpand={() =>
                      setExpandedCauseIndex((current) => (current === index ? null : index))
                    }
                    onMove={(direction) => {
                      setExpandedCauseIndex(index + direction);
                      setForm((current) => ({
                        ...current,
                        candidateCauses: moveItem(current.candidateCauses, index, direction),
                      }));
                    }}
                    onRemove={() => {
                      const nextLength = form.candidateCauses.length - 1;
                      setExpandedCauseIndex(nextLength <= 0 ? null : Math.max(0, Math.min(index, nextLength - 1)));
                      setForm((current) => ({
                        ...current,
                        candidateCauses: current.candidateCauses.filter((_, itemIndex) => itemIndex !== index),
                      }));
                    }}
                    canMoveUp={index > 0}
                    canMoveDown={index < form.candidateCauses.length - 1}
                  >
                    <CauseEditor
                      cause={cause}
                      evidenceChecklist={form.evidenceChecklist}
                      actionsById={actionsById}
                      issues={causeIssues}
                      autoFocusCauseId={expandedCauseIndex === index && index === form.candidateCauses.length - 1}
                      onChange={(nextCause) =>
                        setForm((current) => ({
                          ...current,
                          candidateCauses: current.candidateCauses.map((item, itemIndex) =>
                            itemIndex === index ? nextCause : item
                          ),
                        }))
                      }
                    />
                  </CauseAccordionCard>
                );
              })}
              {form.candidateCauses.length === 0 ? <p className="text-sm text-muted">No causes yet.</p> : null}
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "triggers" ? (
        <div>
          <TabHelpBlock tab="triggers" expanded={helpExpanded} onToggle={toggleHelp} />
          <PanelCard
            title="Escalation triggers"
            actions={
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    escalationTriggers: [...current.escalationTriggers, { trigger: "", reason: "" }],
                  }))
                }
                className="text-sm text-primary"
              >
                Add trigger
              </button>
            }
          >
            <div className="space-y-3">
              {form.escalationTriggers.map((trigger, index) => (
                <div key={`${trigger.trigger}-${index}`} className="grid gap-3 rounded border border-border p-3 md:grid-cols-[1fr_2fr_auto]">
                  <div>
                    <label className="text-xs font-medium text-muted">Trigger text</label>
                    <input
                      className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                      value={trigger.trigger}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          escalationTriggers: current.escalationTriggers.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, trigger: event.target.value } : item
                          ),
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted">Reason</label>
                    <input
                      className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                      value={trigger.reason}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          escalationTriggers: current.escalationTriggers.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, reason: event.target.value } : item
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          escalationTriggers: moveItem(current.escalationTriggers, index, -1),
                        }))
                      }
                      disabled={index === 0}
                      className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          escalationTriggers: moveItem(current.escalationTriggers, index, 1),
                        }))
                      }
                      disabled={index === form.escalationTriggers.length - 1}
                      className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          escalationTriggers: current.escalationTriggers.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                      className="text-sm text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {form.escalationTriggers.length === 0 ? <p className="text-sm text-muted">No escalation triggers yet.</p> : null}
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "steps" ? (
        <div>
          <TabHelpBlock tab="steps" expanded={helpExpanded} onToggle={toggleHelp} />
          <PanelCard
            title="Resolution steps"
            actions={
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    steps: [
                      ...current.steps,
                      {
                        step_id: crypto.randomUUID(),
                        title: "",
                        instruction: "",
                        check: "",
                      } as Step,
                    ],
                  }))
                }
                className="text-sm text-primary"
              >
                Add step
              </button>
            }
          >
            <div className="space-y-3">
              {form.steps.map((step, index) => (
                <div key={step.step_id} className="rounded border border-border p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">Step {index + 1}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({ ...current, steps: moveItem(current.steps, index, -1) }))
                        }
                        disabled={index === 0}
                        className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({ ...current, steps: moveItem(current.steps, index, 1) }))
                        }
                        disabled={index === form.steps.length - 1}
                        className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            steps: current.steps.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                        className="text-sm text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted">Title</label>
                      <input
                        className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                        value={step.title}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            steps: current.steps.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, title: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted">Instruction</label>
                      <textarea
                        className="mt-1 block min-h-24 w-full rounded border border-border px-3 py-2 text-sm"
                        value={step.instruction}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            steps: current.steps.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, instruction: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted">How to verify (optional)</label>
                      <input
                        className="mt-1 block w-full rounded border border-border px-3 py-2 text-sm"
                        value={step.check ?? ""}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            steps: current.steps.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, check: event.target.value } : item
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
              {form.steps.length === 0 ? <p className="text-sm text-muted">No resolution steps yet.</p> : null}
            </div>
          </PanelCard>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded border border-border px-4 py-2">
          Cancel
        </button>
        <span
          className={`flex items-center gap-1.5 text-sm font-medium text-emerald-600 transition-opacity duration-300 ${
            savedFeedback ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-live="polite"
        >
          Saved
        </span>
      </div>
    </div>
  );
}
