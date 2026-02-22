"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type Label = { id: string; displayName: string };
type Step = {
  step_id: string;
  title: string;
  instruction: string;
  check?: string;
  if_failed?: string;
};
type SymptomItem = { id: string; description: string };
type EvidenceItem = {
  id: string;
  description: string;
  actionId?: string;
  type: "photo" | "reading" | "observation" | "action" | "confirmation";
  required: boolean;
};
type CauseItem = {
  id: string;
  cause: string;
  likelihood: "high" | "medium" | "low";
  rulingEvidence: string[];
};
type QuestionItem = {
  id: string;
  question: string;
  purpose: string;
  whenToAsk?: string;
  actionId?: string;
};
type TriggerItem = { trigger: string; reason: string };
type Action = { id: string; title: string };
type ProductTypeOption = { id: string; name: string; isOther: boolean };

type Playbook = {
  id: string;
  labelId: string;
  title: string;
  requiresProductType?: boolean;
  productTypeIds?: string[];
  steps: Step[];
  schemaVersion?: number;
  symptoms?: SymptomItem[] | null;
  evidenceChecklist?: EvidenceItem[] | null;
  candidateCauses?: CauseItem[] | null;
  diagnosticQuestions?: QuestionItem[] | null;
  escalationTriggers?: TriggerItem[] | null;
  updatedAt: string;
};

type PlaybookFormState = {
  labelId: string;
  title: string;
  requiresProductType: boolean;
  productTypeIds: string[];
  steps: Step[];
  symptoms: SymptomItem[];
  evidenceChecklist: EvidenceItem[];
  candidateCauses: CauseItem[];
  diagnosticQuestions: QuestionItem[];
  escalationTriggers: TriggerItem[];
};

const EVIDENCE_TYPES: EvidenceItem["type"][] = [
  "photo",
  "reading",
  "observation",
  "action",
  "confirmation",
];
const LIKELIHOODS: CauseItem["likelihood"][] = ["high", "medium", "low"];
const TABS = [
  "overview",
  "symptoms",
  "evidence",
  "causes",
  "questions",
  "triggers",
  "steps",
] as const;

function toFormState(p: Playbook): PlaybookFormState {
  return {
    labelId: p.labelId,
    title: p.title,
    requiresProductType: Boolean(p.requiresProductType),
    productTypeIds: Array.isArray(p.productTypeIds) ? p.productTypeIds : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
    symptoms: Array.isArray(p.symptoms) ? p.symptoms : [],
    evidenceChecklist: Array.isArray(p.evidenceChecklist) ? p.evidenceChecklist : [],
    candidateCauses: Array.isArray(p.candidateCauses) ? p.candidateCauses : [],
    diagnosticQuestions: Array.isArray(p.diagnosticQuestions) ? p.diagnosticQuestions : [],
    escalationTriggers: Array.isArray(p.escalationTriggers) ? p.escalationTriggers : [],
  };
}

export default function AdminPlaybooksPage() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const focusPlaybookId = params?.id;
  const dedicatedMode = Boolean(focusPlaybookId);
  const [labels, setLabels] = useState<Label[]>([]);
  const [productTypes, setProductTypes] = useState<ProductTypeOption[]>([]);
  const [actionsList, setActionsList] = useState<Action[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetMissing, setTargetMissing] = useState(false);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("overview");
  const [form, setForm] = useState({
    labelId: "",
    title: "",
    requiresProductType: false,
    productTypeIds: [] as string[],
    steps: [] as Step[],
    symptoms: [] as SymptomItem[],
    evidenceChecklist: [] as EvidenceItem[],
    candidateCauses: [] as CauseItem[],
    diagnosticQuestions: [] as QuestionItem[],
    escalationTriggers: [] as TriggerItem[],
  });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/labels").then((r) => r.json()),
      fetch("/api/admin/product-types").then((r) => r.json()),
      fetch("/api/admin/playbooks").then((r) => r.json()),
      fetch("/api/admin/actions").then((r) => r.json()),
    ]).then(([l, pt, p, a]) => {
      setLabels(l);
      setProductTypes(pt);
      setPlaybooks(p);
      setActionsList(a);
      if (focusPlaybookId) {
        const match = (p as Playbook[]).find((item) => item.id === focusPlaybookId);
        if (match) {
          setEditing(match);
          setShowForm(true);
          setActiveTab("overview");
          setForm(toFormState(match));
          setTargetMissing(false);
          setSaveMsg(null);
        } else {
          setTargetMissing(true);
        }
      }
      setLoading(false);
    });
  }, [focusPlaybookId]);

  const addStep = () => {
    setForm((f) => ({
      ...f,
      steps: [
        ...f.steps,
        {
          step_id: crypto.randomUUID(),
          title: "",
          instruction: "",
          check: "",
          if_failed: "",
        },
      ],
    }));
  };

  const updateStep = (index: number, field: keyof Step, value: string) => {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }));
  };

  const removeStep = (index: number) => {
    setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }));
  };

  const addSymptom = () => {
    setForm((f) => ({
      ...f,
      symptoms: [...f.symptoms, { id: "", description: "" }],
    }));
  };
  const updateSymptom = (i: number, field: keyof SymptomItem, value: string) => {
    setForm((f) => ({
      ...f,
      symptoms: f.symptoms.map((s, j) => (j === i ? { ...s, [field]: value } : s)),
    }));
  };
  const removeSymptom = (i: number) => {
    setForm((f) => ({ ...f, symptoms: f.symptoms.filter((_, j) => j !== i) }));
  };

  const addEvidence = () => {
    setForm((f) => ({
      ...f,
      evidenceChecklist: [
        ...f.evidenceChecklist,
        { id: "", description: "", type: "observation", required: false },
      ],
    }));
  };
  const updateEvidence = (i: number, field: keyof EvidenceItem, value: string | boolean) => {
    setForm((f) => ({
      ...f,
      evidenceChecklist: f.evidenceChecklist.map((e, j) =>
        j === i ? { ...e, [field]: value } : e
      ),
    }));
  };
  const removeEvidence = (i: number) => {
    setForm((f) => ({ ...f, evidenceChecklist: f.evidenceChecklist.filter((_, j) => j !== i) }));
  };

  const addCause = () => {
    setForm((f) => ({
      ...f,
      candidateCauses: [
        ...f.candidateCauses,
        { id: "", cause: "", likelihood: "medium", rulingEvidence: [] },
      ],
    }));
  };
  const updateCause = (i: number, field: keyof CauseItem, value: string | string[]) => {
    setForm((f) => ({
      ...f,
      candidateCauses: f.candidateCauses.map((c, j) =>
        j === i ? { ...c, [field]: value } : c
      ),
    }));
  };
  const removeCause = (i: number) => {
    setForm((f) => ({ ...f, candidateCauses: f.candidateCauses.filter((_, j) => j !== i) }));
  };

  const addQuestion = () => {
    setForm((f) => ({
      ...f,
      diagnosticQuestions: [...f.diagnosticQuestions, { id: "", question: "", purpose: "" }],
    }));
  };
  const updateQuestion = (i: number, field: keyof QuestionItem, value: string) => {
    setForm((f) => ({
      ...f,
      diagnosticQuestions: f.diagnosticQuestions.map((q, j) =>
        j === i ? { ...q, [field]: value } : q
      ),
    }));
  };
  const removeQuestion = (i: number) => {
    setForm((f) => ({
      ...f,
      diagnosticQuestions: f.diagnosticQuestions.filter((_, j) => j !== i),
    }));
  };

  const addTrigger = () => {
    setForm((f) => ({
      ...f,
      escalationTriggers: [...f.escalationTriggers, { trigger: "", reason: "" }],
    }));
  };
  const updateTrigger = (i: number, field: keyof TriggerItem, value: string) => {
    setForm((f) => ({
      ...f,
      escalationTriggers: f.escalationTriggers.map((t, j) =>
        j === i ? { ...t, [field]: value } : t
      ),
    }));
  };
  const removeTrigger = (i: number) => {
    setForm((f) => ({ ...f, escalationTriggers: f.escalationTriggers.filter((_, j) => j !== i) }));
  };

  const savePlaybook = async () => {
    if (!form.labelId || !form.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          labelId: form.labelId,
          title: form.title,
          requiresProductType: form.requiresProductType,
          productTypeIds: form.requiresProductType ? form.productTypeIds : [],
          steps: form.steps,
          symptoms: form.symptoms.length ? form.symptoms : null,
          evidenceChecklist: form.evidenceChecklist.length
            ? form.evidenceChecklist.map((e) => ({
                ...e,
                actionId: e.actionId?.trim() || undefined,
              }))
            : null,
          candidateCauses: form.candidateCauses.length ? form.candidateCauses : null,
          diagnosticQuestions: form.diagnosticQuestions.length
            ? form.diagnosticQuestions.map((q) => ({
                ...q,
                actionId: q.actionId?.trim() || undefined,
              }))
            : null,
          escalationTriggers: form.escalationTriggers.length ? form.escalationTriggers : null,
        }),
      });
      const saved = await res.json();
      if (res.ok) {
        setPlaybooks((prev) => {
          const idx = prev.findIndex((p) => p.id === saved.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = saved;
            return next;
          }
          return [...prev, saved];
        });
        setSaveMsg("Playbook saved successfully.");
        if (dedicatedMode) {
          setEditing(saved);
          setForm(toFormState(saved));
        } else {
          setEditing(null);
          setShowForm(false);
          setForm({
            labelId: "",
            title: "",
            requiresProductType: false,
            productTypeIds: [],
            steps: [],
            symptoms: [],
            evidenceChecklist: [],
            candidateCauses: [],
            diagnosticQuestions: [],
            escalationTriggers: [],
          });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    setSaveMsg(null);
    setEditing(null);
    setShowForm(true);
    setActiveTab("overview");
    setForm({
      labelId: labels[0]?.id ?? "",
      title: "",
      requiresProductType: false,
      productTypeIds: [],
      steps: [],
      symptoms: [],
      evidenceChecklist: [],
      candidateCauses: [],
      diagnosticQuestions: [],
      escalationTriggers: [],
    });
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/playbooks/import", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ type: "error", text: data.error ?? "Import failed" });
        return;
      }
      setPlaybooks((prev) => [...prev, data]);
      setImportMsg({ type: "success", text: `Playbook "${data.title}" imported successfully.` });
    } catch {
      setImportMsg({ type: "error", text: "Failed to upload file." });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (playbook: Playbook) => {
    if (!confirm(`Delete playbook "${playbook.title}"? This cannot be undone.`)) return;
    setDeleteError(null);
    setDeletingId(playbook.id);
    try {
      const res = await fetch(`/api/admin/playbooks/${playbook.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error ?? "Delete failed");
        return;
      }
      setPlaybooks((prev) => prev.filter((p) => p.id !== playbook.id));
      if (editing?.id === playbook.id) {
        setEditing(null);
        setShowForm(false);
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{dedicatedMode ? "Edit playbook" : "Playbooks"}</h1>
        <div className="flex items-center gap-4">
          {dedicatedMode && (
            <Link href="/admin/playbooks" className="text-blue-600 hover:underline">
              ← Back to playbooks
            </Link>
          )}
          <Link href="/admin" className="text-blue-600 hover:underline">
            ← Dashboard
          </Link>
        </div>
      </div>

      {!dedicatedMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={startNew}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            New playbook
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded border border-blue-600 px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import from Excel"}
          </button>
          <a
            href="/api/admin/playbooks/template"
            download
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Download template
          </a>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
        </div>
      )}

      {saveMsg && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
          <span>{saveMsg}</span>
          <button
            onClick={() => setSaveMsg(null)}
            className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {importMsg && (
        <div
          className={`mb-4 rounded px-4 py-3 text-sm ${
            importMsg.type === "success"
              ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="whitespace-pre-wrap">{importMsg.text}</span>
            <button
              onClick={() => setImportMsg(null)}
              className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {deleteError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {deleteError}
        </div>
      )}

      {targetMissing && dedicatedMode && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          Playbook not found. It may have been deleted.
        </div>
      )}

      {(dedicatedMode ? !!editing : editing || showForm) && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 font-medium">
            {editing ? "Edit playbook" : "Create playbook"}
          </h2>

          <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-600">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTab === t
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <>
              <div className="mb-4">
                <label className="group/tip relative inline-block text-sm font-medium text-gray-600 dark:text-gray-400 cursor-help">
                  Label <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    The category this playbook belongs to (e.g. Too runny, Too thick). The assistant uses this to pick the right playbook for the user&apos;s issue. Create labels in Admin → Labels first.
                  </span>
                </label>
                <select
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                  value={form.labelId}
                  onChange={(e) => setForm((f) => ({ ...f, labelId: e.target.value }))}
                >
                  {labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="group/tip relative inline-block text-sm font-medium text-gray-600 dark:text-gray-400 cursor-help">
                  Title <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    A short, descriptive name for this playbook (e.g. &quot;Fix too runny&quot;, &quot;Fix too thick texture — Spaceman&quot;). Shown in admin and used to identify the guide.
                  </span>
                </label>
                <input
                  type="text"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Fix too runny"
                />
              </div>
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={form.requiresProductType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, requiresProductType: e.target.checked }))
                    }
                  />
                  Require product type before diagnosis
                </label>
              </div>
              {form.requiresProductType && (
                <div className="mb-4 rounded border border-gray-200 p-3 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Applicable product types
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Leave empty to apply to all product types.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {productTypes.map((productType) => {
                      const checked = form.productTypeIds.includes(productType.id);
                      return (
                        <label
                          key={productType.id}
                          className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setForm((f) => ({
                                ...f,
                                productTypeIds: e.target.checked
                                  ? [...f.productTypeIds, productType.id]
                                  : f.productTypeIds.filter((id) => id !== productType.id),
                              }));
                            }}
                          />
                          {productType.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {editing?.schemaVersion != null && (
                <p className="text-sm text-gray-500">Schema version: {editing.schemaVersion}</p>
              )}
            </>
          )}

          {activeTab === "symptoms" && (
            <div>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                Symptom descriptions that may trigger this playbook
              </p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400 dark:border-gray-500">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    Phrases or descriptions the user might say (e.g. &quot;watery&quot;, &quot;won&apos;t hold shape&quot;). These help the assistant recognise that this playbook applies.
                  </span>
                </span>
              </p>
              {form.symptoms.map((s, i) => (
                <div key={i} className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      ID <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Short unique slug (e.g. watery, melts_fast). Lowercase, underscores OK. Leave blank to auto-generate.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. watery"
                      className="w-40 rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={s.id}
                      onChange={(e) => updateSymptom(i, "id", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Description <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Plain-language symptom (e.g. &quot;Watery texture&quot;, &quot;Product melts too fast&quot;).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Watery texture"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={s.description}
                      onChange={(e) => updateSymptom(i, "description", e.target.value)}
                    />
                  </div>
                  <button type="button" onClick={() => removeSymptom(i)} className="text-red-600 text-sm shrink-0">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addSymptom} className="text-sm text-blue-600 hover:underline">
                Add symptom
              </button>
            </div>
          )}

          {activeTab === "evidence" && (
            <div>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                Evidence to gather (link to Action for instructions)
              </p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400 dark:border-gray-500">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    Each item is something the assistant should try to collect (photo, reading, observation, etc.). Required items must be gathered before the assistant can suggest a cause and steps.
                  </span>
                </span>
              </p>
              {form.evidenceChecklist.map((e, i) => (
                <div key={i} className="mb-3 rounded border border-gray-200 p-2 dark:border-gray-600">
                  <div className="mb-2 flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        Evidence ID <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Unique slug (e.g. hopper_temp, dispense_photo). Used when linking causes to this evidence.
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. hopper_temp"
                        className="w-40 rounded border px-2 py-1 text-sm dark:bg-gray-800"
                        value={e.id}
                        onChange={(ev) => updateEvidence(i, "id", ev.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        Type <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          photo = user sends image; reading = numeric/value; observation = user describes; action = they perform a task; confirmation = yes/no.
                        </span>
                      </label>
                      <select
                        className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
                        value={e.type}
                        onChange={(ev) => updateEvidence(i, "type", ev.target.value as EvidenceItem["type"])}
                      >
                        {EVIDENCE_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-1 text-sm cursor-help" title="Must be collected before suggesting a cause">
                      <input
                        type="checkbox"
                        checked={e.required}
                        onChange={(ev) => updateEvidence(i, "required", ev.target.checked)}
                      />
                      Required
                    </label>
                    <button type="button" onClick={() => removeEvidence(i)} className="text-red-600 text-sm shrink-0">
                      Remove
                    </button>
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Description <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        What to ask for in plain language (e.g. &quot;Hopper temperature reading&quot;).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Hopper temperature reading"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={e.description}
                      onChange={(ev) => updateEvidence(i, "description", ev.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Action (optional) <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Link to an Action to show the user step-by-step instructions for collecting this evidence (e.g. how to read the display).
                      </span>
                    </label>
                    <select
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={e.actionId ?? ""}
                      onChange={(ev) => updateEvidence(i, "actionId", ev.target.value || "")}
                    >
                      <option value="">No action</option>
                      {actionsList.map((a) => (
                        <option key={a.id} value={a.id}>{a.title} ({a.id})</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addEvidence} className="text-sm text-blue-600 hover:underline">
                Add evidence item
              </button>
            </div>
          )}

          {activeTab === "causes" && (
            <div>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Candidate root causes</p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                List possible root causes. The assistant narrows these down as the user provides evidence.{" "}
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400 dark:border-gray-500">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    List the possible underlying problems the assistant will choose between. For each cause, set likelihood and which evidence helps confirm or rule it out.
                  </span>
                </span>
              </p>
              {form.candidateCauses.map((c, i) => (
                <div key={i} className="mb-3 rounded border border-gray-200 p-2 dark:border-gray-600">
                  <div className="mb-2 flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        Cause ID <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Short unique slug used in the system (e.g. hopper_too_warm). Use lowercase letters and underscores only. No spaces.
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. hopper_too_warm"
                        className="w-40 rounded border px-2 py-1 text-sm dark:bg-gray-800"
                        value={c.id}
                        onChange={(ev) => updateCause(i, "id", ev.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        Likelihood <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Starting priority before any evidence is collected. The assistant uses this to order and update hypotheses as evidence comes in.
                        </span>
                      </label>
                      <select
                        className="rounded border px-2 py-1 text-sm dark:bg-gray-800"
                        value={c.likelihood}
                        onChange={(ev) => updateCause(i, "likelihood", ev.target.value as CauseItem["likelihood"])}
                      >
                        {LIKELIHOODS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <button type="button" onClick={() => removeCause(i)} className="text-red-600 text-sm">
                      Remove
                    </button>
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Cause description <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Plain-language explanation of this root cause. Shown in the diagnosis and used by the assistant when explaining to the user.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Hopper temperature too high (product not cold enough to set properly)"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={c.cause}
                      onChange={(ev) => updateCause(i, "cause", ev.target.value)}
                    />
                  </div>
                  <div className="mt-1">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 cursor-help">
                      Ruling evidence <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Check the evidence items that help confirm or rule out this cause. When the user provides a value for checked evidence, the assistant uses it to update whether this cause is likely or ruled out.
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Evidence that helps confirm or rule out this cause. Select all that apply.
                    </p>
                    {form.evidenceChecklist.length === 0 ? (
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Add evidence items in the Evidence tab first, then assign them here.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {form.evidenceChecklist.map((e) => {
                          const checked = c.rulingEvidence?.includes(e.id) ?? false;
                          return (
                            <label key={e.id} className="flex items-center gap-1.5 text-sm cursor-pointer" title={e.description || undefined}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = checked
                                    ? (c.rulingEvidence ?? []).filter((id) => id !== e.id)
                                    : [...(c.rulingEvidence ?? []), e.id];
                                  updateCause(i, "rulingEvidence", next);
                                }}
                                className="rounded border-gray-300 dark:border-gray-600"
                              />
                              <span>{e.id}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={addCause} className="text-sm text-blue-600 hover:underline">
                Add cause
              </button>
            </div>
          )}

          {activeTab === "questions" && (
            <div>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Diagnostic questions</p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400 dark:border-gray-500">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    Suggested questions the assistant can ask to gather evidence and narrow down causes. Purpose and when-to-ask help keep the conversation focused and in a logical order.
                  </span>
                </span>
              </p>
              {form.diagnosticQuestions.map((q, i) => (
                <div key={i} className="mb-3 rounded border border-gray-200 p-2 dark:border-gray-600">
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Question ID <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Short unique slug (e.g. ask_temp, ask_mix). Lowercase, underscores OK. Leave blank to auto-generate on import.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. ask_temp"
                      className="w-40 rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={q.id}
                      onChange={(ev) => updateQuestion(i, "id", ev.target.value)}
                    />
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Question text <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        The exact question to ask the user, as they will see it (e.g. &quot;What temperature does the hopper display show?&quot;).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. What temperature does the hopper display show?"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={q.question}
                      onChange={(ev) => updateQuestion(i, "question", ev.target.value)}
                    />
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Purpose <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Why we ask this (e.g. &quot;Check if hopper is running too cold&quot;, &quot;Rule out incorrect mix concentration&quot;). Links the question to possible causes.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Check if hopper is running too cold"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={q.purpose}
                      onChange={(ev) => updateQuestion(i, "purpose", ev.target.value)}
                    />
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      When to ask (optional) <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        When this question should be asked (e.g. &quot;Always ask first&quot;, &quot;After temperature check&quot;, &quot;If product still thick after temp check&quot;). Helps order the conversation.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Always ask first"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={q.whenToAsk ?? ""}
                      onChange={(ev) => updateQuestion(i, "whenToAsk", ev.target.value)}
                    />
                  </div>
                  <div className="mb-2 flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Action (optional) <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        If the user needs to perform a task to answer (e.g. read a display), link an Action here to show them how. Otherwise leave &quot;No action&quot;.
                      </span>
                    </label>
                    <select
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={q.actionId ?? ""}
                      onChange={(ev) => updateQuestion(i, "actionId", ev.target.value || "")}
                    >
                      <option value="">No action</option>
                      {actionsList.map((a) => (
                        <option key={a.id} value={a.id}>{a.title}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={() => removeQuestion(i)} className="text-red-600 text-sm">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addQuestion} className="text-sm text-blue-600 hover:underline">
                Add question
              </button>
            </div>
          )}

          {activeTab === "triggers" && (
            <div>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                Escalation triggers (if user message contains trigger text)
              </p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400 dark:border-gray-500">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    When the user mentions one of these phrases, the assistant stops diagnosing and escalates to a person. Use phrases customers might actually say (e.g. &quot;smell of burning&quot;, &quot;error code&quot;).
                  </span>
                </span>
              </p>
              {form.escalationTriggers.map((t, i) => (
                <div key={i} className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Trigger text <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Keyword or phrase that means &quot;escalate&quot; (e.g. electrical smell, refrigerant leak, error code).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. electrical smell"
                      className="w-48 rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={t.trigger}
                      onChange={(ev) => updateTrigger(i, "trigger", ev.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                    <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                      Reason <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Why we escalate when this trigger is mentioned (e.g. &quot;Potential electrical hazard&quot;). Shown to the user.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Potential electrical hazard"
                      className="w-full rounded border px-2 py-1 text-sm dark:bg-gray-800"
                      value={t.reason}
                      onChange={(ev) => updateTrigger(i, "reason", ev.target.value)}
                    />
                  </div>
                  <button type="button" onClick={() => removeTrigger(i)} className="text-red-600 text-sm shrink-0">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addTrigger} className="text-sm text-blue-600 hover:underline">
                Add trigger
              </button>
            </div>
          )}

          {activeTab === "steps" && (
            <div>
              <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Resolution steps</p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400 dark:border-gray-500">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    The exact actions the user should take once a cause is chosen. Order matters — steps are shown in sequence. The assistant may only suggest steps defined here.
                  </span>
                </span>
              </p>
              <ul className="mt-2 space-y-4">
                {form.steps.map((step, index) => (
                  <li
                    key={step.step_id}
                    className="rounded border border-gray-200 p-4 dark:border-gray-700"
                  >
                    <div className="mb-2 flex justify-between">
                      <span className="text-sm font-medium">Step {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mb-2 flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        Step title <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Short heading for this step (e.g. &quot;Cool hopper to operating range&quot;).
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Cool hopper to operating range"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                        value={step.title}
                        onChange={(e) => updateStep(index, "title", e.target.value)}
                      />
                    </div>
                    <div className="mb-2 flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        Instruction <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          What the user should do, in full. This is the main text they will see for this step.
                        </span>
                      </label>
                      <textarea
                        placeholder="e.g. Allow the machine time to cool. Hopper should be in the -8°C to -4°C range..."
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                        rows={2}
                        value={step.instruction}
                        onChange={(e) => updateStep(index, "instruction", e.target.value)}
                      />
                    </div>
                    <div className="mb-2 flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        How to verify (optional) <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          How the user can confirm the step worked (e.g. &quot;Hopper display shows -8°C to -4°C&quot;).
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Hopper display shows temperature within range"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                        value={step.check ?? ""}
                        onChange={(e) => updateStep(index, "check", e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-gray-600 dark:text-gray-400 cursor-help">
                        If failed / escalate (optional) <span className="text-gray-400 dark:text-gray-500" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          What to do if the step doesn&apos;t work (e.g. &quot;If temperature doesn&apos;t drop, escalate to technician&quot;).
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. If temperature does not drop, escalate to technician"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                        value={step.if_failed ?? ""}
                        onChange={(e) => updateStep(index, "if_failed", e.target.value)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={addStep}
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Add step
              </button>
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <button
              onClick={savePlaybook}
              disabled={saving}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                if (dedicatedMode) {
                  router.push("/admin/playbooks");
                  return;
                }
                setEditing(null);
                setShowForm(false);
                setForm({
                  labelId: "",
                  title: "",
                  requiresProductType: false,
                  productTypeIds: [],
                  steps: [],
                  symptoms: [],
                  evidenceChecklist: [],
                  candidateCauses: [],
                  diagnosticQuestions: [],
                  escalationTriggers: [],
                });
              }}
              className="rounded border border-gray-300 px-4 py-2 dark:border-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!dedicatedMode && (
        <ul className="space-y-2">
          {playbooks.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            >
              <div>
                <span className="font-medium">{p.title}</span>
                <span className="ml-2 text-sm text-gray-500">
                  ({labels.find((l) => l.id === p.labelId)?.displayName ?? p.labelId})
                </span>
                <p className="text-sm text-gray-500">
                  {Array.isArray(p.steps) ? p.steps.length : 0} steps
                  {Array.isArray(p.symptoms) && p.symptoms.length > 0 && `, ${p.symptoms.length} symptoms`}
                  {Array.isArray(p.evidenceChecklist) && p.evidenceChecklist.length > 0 &&
                    `, ${p.evidenceChecklist.length} evidence`}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/admin/playbooks/${p.id}`}
                  className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-gray-600"
                >
                  Edit
                </Link>
                <button
                  onClick={() => handleDelete(p)}
                  disabled={deletingId === p.id}
                  className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:hover:bg-red-900/20"
                >
                  {deletingId === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
