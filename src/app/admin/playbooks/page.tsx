"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useAdminRole } from "@/app/admin/AdminSidebarProvider";

type Label = { id: string; displayName: string };
type Step = {
  step_id: string;
  title: string;
  instruction: string;
  check?: string;
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
type TriggerItem = { trigger: string; reason: string };
type Action = { id: string; title: string };
type ProductTypeOption = { id: string; name: string; isOther: boolean };

type Playbook = {
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

type PlaybookFormState = {
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
  "triggers",
  "steps",
] as const;

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function toFormState(p: Playbook): PlaybookFormState {
  return {
    labelId: p.labelId,
    title: p.title,
    enabled: Boolean(p.enabled),
    productTypeIds: Array.isArray(p.productTypeIds) ? p.productTypeIds : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
    symptoms: Array.isArray(p.symptoms) ? p.symptoms : [],
    evidenceChecklist: Array.isArray(p.evidenceChecklist) ? p.evidenceChecklist : [],
    candidateCauses: Array.isArray(p.candidateCauses) ? p.candidateCauses : [],
    escalationTriggers: Array.isArray(p.escalationTriggers) ? p.escalationTriggers : [],
  };
}

function parseTabFromParams(searchParams: ReturnType<typeof useSearchParams>): (typeof TABS)[number] {
  const t = searchParams.get("tab");
  return t && TABS.includes(t as (typeof TABS)[number]) ? (t as (typeof TABS)[number]) : "overview";
}

export default function AdminPlaybooksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>(() => parseTabFromParams(searchParams));
  const [form, setForm] = useState({
    labelId: "",
    title: "",
    enabled: false,
    productTypeIds: [] as string[],
    steps: [] as Step[],
    symptoms: [] as SymptomItem[],
    evidenceChecklist: [] as EvidenceItem[],
    candidateCauses: [] as CauseItem[],
    escalationTriggers: [] as TriggerItem[],
  });
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const adminRole = useAdminRole();
  const showSchemaVersion = adminRole === "admin";

  const dragSrcEvidence = useRef<number | null>(null);
  const dragSrcTrigger = useRef<number | null>(null);
  const dragSrcStep = useRef<number | null>(null);
  const [dragOverEvidenceIdx, setDragOverEvidenceIdx] = useState<number | null>(null);
  const [dragOverTriggerIdx, setDragOverTriggerIdx] = useState<number | null>(null);
  const [dragOverStepIdx, setDragOverStepIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/labels").then((r) => r.json()),
      fetch("/api/admin/product-types").then((r) => r.json()),
      fetch("/api/admin/playbooks").then((r) => r.json()),
      fetch("/api/admin/actions").then((r) => r.json()),
    ]).then(([l, pt, p, a]) => {
      setLabels(l);
      setProductTypes(pt);
      setPlaybooks((p as Playbook[]).map((playbook) => ({ ...playbook, enabled: Boolean(playbook.enabled) })));
      setActionsList(a);
      if (focusPlaybookId) {
        const match = (p as Playbook[]).find((item) => item.id === focusPlaybookId);
        if (match) {
          setEditing(match);
          setShowForm(true);
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

  useEffect(() => {
    setActiveTab(parseTabFromParams(searchParams));
  }, [searchParams]);

  const setActiveTabWithUrl = (tab: (typeof TABS)[number]) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(playbooks.length / PAGE_SIZE));
    setPage((prev) => Math.min(prev, maxPage));
  }, [playbooks.length]);

  const totalPlaybooks = playbooks.length;
  const totalPages = Math.ceil(totalPlaybooks / PAGE_SIZE);
  const paginatedPlaybooks = useMemo(
    () => playbooks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [playbooks, page]
  );
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

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
          enabled: form.enabled,
          productTypeIds: form.productTypeIds,
          steps: form.steps,
          symptoms: form.symptoms.length ? form.symptoms : null,
          evidenceChecklist: form.evidenceChecklist.length
            ? form.evidenceChecklist.map((e) => ({
                ...e,
                actionId: e.actionId?.trim() || undefined,
              }))
            : null,
          candidateCauses: form.candidateCauses.length ? form.candidateCauses : null,
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
        if (savedFeedbackTimer.current) clearTimeout(savedFeedbackTimer.current);
        setSavedFeedback(true);
        savedFeedbackTimer.current = setTimeout(() => setSavedFeedback(false), 2500);
        if (dedicatedMode) {
          setEditing(saved);
          setForm(toFormState(saved));
        } else {
          setEditing(null);
          setShowForm(false);
          setForm({
            labelId: "",
            title: "",
            enabled: false,
            productTypeIds: [],
            steps: [],
            symptoms: [],
            evidenceChecklist: [],
            candidateCauses: [],
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
    setActiveTabWithUrl("overview");
    setForm({
      labelId: labels[0]?.id ?? "",
      title: "",
      enabled: false,
      productTypeIds: [],
      steps: [],
      symptoms: [],
      evidenceChecklist: [],
      candidateCauses: [],
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
      setPlaybooks((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === data.id);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = data;
          return next;
        }
        return [...prev, data];
      });
      const wasExisting = playbooks.some((item) => item.id === data.id);
      setImportMsg({
        type: "success",
        text: wasExisting
          ? `Playbook "${data.title}" updated successfully from Excel.`
          : `Playbook "${data.title}" imported successfully.`,
      });
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

  const togglePlaybookEnabled = async (playbook: Playbook) => {
    setTogglingId(playbook.id);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: playbook.id,
          labelId: playbook.labelId,
          title: playbook.title,
          enabled: !playbook.enabled,
          productTypeIds: playbook.productTypeIds ?? [],
          steps: Array.isArray(playbook.steps) ? playbook.steps : [],
          symptoms: Array.isArray(playbook.symptoms) && playbook.symptoms.length > 0 ? playbook.symptoms : null,
          evidenceChecklist:
            Array.isArray(playbook.evidenceChecklist) && playbook.evidenceChecklist.length > 0
              ? playbook.evidenceChecklist
              : null,
          candidateCauses:
            Array.isArray(playbook.candidateCauses) && playbook.candidateCauses.length > 0
              ? playbook.candidateCauses
              : null,
          escalationTriggers:
            Array.isArray(playbook.escalationTriggers) && playbook.escalationTriggers.length > 0
              ? playbook.escalationTriggers
              : null,
        }),
      });
      const saved = await res.json();
      if (!res.ok) return;

      setPlaybooks((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      if (editing?.id === saved.id) {
        setEditing(saved);
        setForm(toFormState(saved));
      }
      setSaveMsg(saved.enabled ? "Playbook enabled for diagnosis triage." : "Playbook disabled for diagnosis triage.");
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title={dedicatedMode ? "Edit playbook" : "Playbooks"}
        actions={
          <div className="flex items-center gap-4">
            {editing && (
              <a
                href={`/api/admin/playbooks/${editing.id}/export`}
                download
                className="rounded border border-border px-3 py-1 text-sm"
              >
                Export Excel
              </a>
            )}
            {dedicatedMode && (
              <Link href="/admin/playbooks" className="text-primary hover:underline">
                ← Back to playbooks
              </Link>
            )}
            <Link href="/admin" className="text-primary hover:underline">
              ← Dashboard
            </Link>
          </div>
        }
      />

      {!dedicatedMode && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={startNew}
              className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-hover"
            >
              New playbook
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="rounded border border-primary px-4 py-2 text-primary hover:bg-aqua/30 disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import from Excel"}
            </button>
            <a
              href="/api/admin/playbooks/template"
              download
              className="rounded border border-border px-4 py-2 text-sm text-muted hover:bg-aqua/30"
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
          <p className="mt-2 text-xs text-muted">
            Export an existing playbook to get a prefilled workbook for edits/re-import.
          </p>
          <p className="mt-1 text-xs text-muted">
            In the template Overview sheet, use <code>product_type_ids</code> for comma-separated IDs or{" "}
            <code>product_type_names</code> for comma-separated names from the Reference tab. Leave both blank
            to apply to all product types. Keep <code>playbook_id</code> populated to update on import.
          </p>
        </div>
      )}

      {saveMsg && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
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
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
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
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {targetMissing && dedicatedMode && (
        <div className="rounded border border-accent/30 bg-accent/10 p-3 text-sm text-ink">
          Playbook not found. It may have been deleted.
        </div>
      )}

      {(dedicatedMode ? !!editing : editing || showForm) && (
        <div className={dedicatedMode ? "xl:max-w-[50%]" : undefined}>
          <div className="mb-8 rounded-lg border border-border bg-surface p-6">
          <div className="mb-4 flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">
                {editing ? "Edit playbook" : "Create playbook"}
              </h2>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
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
            {showSchemaVersion && editing?.schemaVersion != null && (
              <p className="text-xs text-muted">Schema version: {editing.schemaVersion}</p>
            )}
          </div>
          <div className={`mb-5 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            form.enabled
              ? "border border-green-200 bg-green-50 text-green-800"
              : "border border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            <span className="font-medium">{form.enabled ? "Enabled" : "Disabled"}</span>
            <span className="text-xs opacity-75">
              {form.enabled
                ? "— this playbook will be used in diagnosis triage"
                : "— this playbook is excluded from diagnosis triage"}
            </span>
          </div>

          <div className="mb-4 flex flex-wrap gap-2 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTabWithUrl(t)}
                className={`rounded px-3 py-1.5 text-sm ${
                  activeTab === t
                    ? "bg-primary text-white"
                    : "bg-page"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <>
              <div className="mb-4">
                <label className="group/tip relative inline-block text-sm font-medium text-muted cursor-help">
                  Label <span className="text-muted" aria-hidden>ⓘ</span>
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    The category this playbook belongs to (e.g. Too runny, Too thick). The assistant uses this to pick the right playbook for the user&apos;s issue. Create labels in Admin → Labels first.
                  </span>
                </label>
                <select
                  className="mt-1 block w-full rounded border border-border px-3 py-2"
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
                <label className="group/tip relative inline-block text-sm font-medium text-muted cursor-help">
                  Title <span className="text-muted" aria-hidden>ⓘ</span>
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    A short, descriptive name for this playbook (e.g. &quot;Fix too runny&quot;, &quot;Fix too thick texture — Spaceman&quot;). Shown in admin and used to identify the guide.
                  </span>
                </label>
                <input
                  type="text"
                  className="mt-1 block w-full rounded border border-border px-3 py-2"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Fix too runny"
                />
              </div>
              <div className="mb-4 rounded border border-border p-3">
                <p className="text-sm font-medium text-ink">
                  Applicable product types
                </p>
                <p className="mt-1 text-xs text-muted">
                  Leave empty to apply to all product types.
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                  {productTypes.map((productType) => {
                    const checked = form.productTypeIds.includes(productType.id);
                    return (
                      <label
                        key={productType.id}
                        className="flex items-center gap-2 text-sm text-ink"
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
            </>
          )}

          {activeTab === "symptoms" && (
            <div>
              <p className="mb-2 text-sm text-muted">
                Symptom descriptions that may trigger this playbook
              </p>
              <p className="mb-3 text-xs text-muted">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    Phrases or descriptions the user might say (e.g. &quot;watery&quot;, &quot;won&apos;t hold shape&quot;). These help the assistant recognise that this playbook applies.
                  </span>
                </span>
              </p>
              {form.symptoms.map((s, i) => (
                <div key={i} className="mb-3 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      ID <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Short unique slug (e.g. watery, melts_fast). Lowercase, underscores OK. Leave blank to auto-generate.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. watery"
                      className="w-40 rounded border px-2 py-1 text-sm"
                      value={s.id}
                      onChange={(e) => updateSymptom(i, "id", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      Description <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Plain-language symptom (e.g. &quot;Watery texture&quot;, &quot;Product melts too fast&quot;).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Watery texture"
                      className="w-full rounded border px-2 py-1 text-sm"
                      value={s.description}
                      onChange={(e) => updateSymptom(i, "description", e.target.value)}
                    />
                  </div>
                  <button type="button" onClick={() => removeSymptom(i)} className="text-red-600 text-sm shrink-0">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addSymptom} className="text-sm text-primary hover:underline">
                Add symptom
              </button>
            </div>
          )}

          {activeTab === "evidence" && (
            <div>
              <p className="mb-2 text-sm text-muted">
                Evidence to gather (link to Action for instructions)
              </p>
              <p className="mb-3 text-xs text-muted">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    Each item is something the assistant should try to collect (photo, reading, observation, etc.). Required items must be gathered before the assistant can suggest a cause and steps.
                  </span>
                </span>
              </p>
              {form.evidenceChecklist.map((e, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; dragSrcEvidence.current = i; }}
                  onDragOver={(ev) => { ev.preventDefault(); setDragOverEvidenceIdx(i); }}
                  onDragLeave={() => setDragOverEvidenceIdx(null)}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    if (dragSrcEvidence.current !== null && dragSrcEvidence.current !== i) {
                      setForm((f) => ({ ...f, evidenceChecklist: reorder(f.evidenceChecklist, dragSrcEvidence.current!, i) }));
                    }
                    dragSrcEvidence.current = null;
                    setDragOverEvidenceIdx(null);
                  }}
                  onDragEnd={() => { dragSrcEvidence.current = null; setDragOverEvidenceIdx(null); }}
                  className={`mb-3 rounded border p-2 transition-colors ${dragOverEvidenceIdx === i ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="mb-2 flex flex-wrap items-end gap-2">
                    <span className="cursor-grab self-center select-none text-gray-400 mr-0.5" title="Drag to reorder">
                      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                        <circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
                        <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                        <circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
                      </svg>
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        Evidence ID <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Unique slug (e.g. hopper_temp, dispense_photo). Used when linking causes to this evidence.
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. hopper_temp"
                        className="w-40 rounded border px-2 py-1 text-sm"
                        value={e.id}
                        onChange={(ev) => updateEvidence(i, "id", ev.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        Type <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          photo = user sends image; reading = numeric/value; observation = user describes; action = they perform a task; confirmation = yes/no.
                        </span>
                      </label>
                      <select
                        className="rounded border px-2 py-1 text-sm"
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
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      Description <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        What to ask for in plain language (e.g. &quot;Hopper temperature reading&quot;).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Hopper temperature reading"
                      className="w-full rounded border px-2 py-1 text-sm"
                      value={e.description}
                      onChange={(ev) => updateEvidence(i, "description", ev.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      Action (optional) <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Link to an Action to show the user step-by-step instructions for collecting this evidence (e.g. how to read the display).
                      </span>
                    </label>
                    <select
                      className="w-full rounded border px-2 py-1 text-sm"
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
              <button type="button" onClick={addEvidence} className="text-sm text-primary hover:underline">
                Add evidence item
              </button>
            </div>
          )}

          {activeTab === "causes" && (
            <div>
              <p className="mb-2 text-sm text-muted">Candidate root causes</p>
              <p className="mb-3 text-xs text-muted">
                List possible root causes. The assistant narrows these down as the user provides evidence.{" "}
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    List the possible underlying problems the assistant will choose between. For each cause, set likelihood and which evidence helps confirm or rule it out.
                  </span>
                </span>
              </p>
              {form.candidateCauses.map((c, i) => (
                <div key={i} className="mb-3 rounded border border-border p-2">
                  <div className="mb-2 flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        Cause ID <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Short unique slug used in the system (e.g. hopper_too_warm). Use lowercase letters and underscores only. No spaces.
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. hopper_too_warm"
                        className="w-40 rounded border px-2 py-1 text-sm"
                        value={c.id}
                        onChange={(ev) => updateCause(i, "id", ev.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        Likelihood <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Starting priority before any evidence is collected. The assistant uses this to order and update hypotheses as evidence comes in.
                        </span>
                      </label>
                      <select
                        className="rounded border px-2 py-1 text-sm"
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
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      Cause description <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Plain-language explanation of this root cause. Shown in the diagnosis and used by the assistant when explaining to the user.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Hopper temperature too high (product not cold enough to set properly)"
                      className="w-full rounded border px-2 py-1 text-sm"
                      value={c.cause}
                      onChange={(ev) => updateCause(i, "cause", ev.target.value)}
                    />
                  </div>
                  <div className="mt-1">
                    <label className="group/tip relative inline-block text-xs font-medium text-muted mb-1 cursor-help">
                      Ruling evidence <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Check the evidence items that help confirm or rule out this cause. When the user provides a value for checked evidence, the assistant uses it to update whether this cause is likely or ruled out.
                      </span>
                    </label>
                    <p className="text-xs text-muted mb-1">
                      Evidence that helps confirm or rule out this cause. Select all that apply.
                    </p>
                    {form.evidenceChecklist.length === 0 ? (
                      <p className="text-sm text-amber-600">
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
                                className="rounded border-border"
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
              <button type="button" onClick={addCause} className="text-sm text-primary hover:underline">
                Add cause
              </button>
            </div>
          )}

          {activeTab === "triggers" && (
            <div>
              <p className="mb-2 text-sm text-muted">
                Escalation triggers (if user message contains trigger text)
              </p>
              <p className="mb-3 text-xs text-muted">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400">
                  ⓘ
                  <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                    When the user mentions one of these phrases, the assistant stops diagnosing and escalates to a person. Use phrases customers might actually say (e.g. &quot;smell of burning&quot;, &quot;error code&quot;).
                  </span>
                </span>
              </p>
              {form.escalationTriggers.map((t, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; dragSrcTrigger.current = i; }}
                  onDragOver={(ev) => { ev.preventDefault(); setDragOverTriggerIdx(i); }}
                  onDragLeave={() => setDragOverTriggerIdx(null)}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    if (dragSrcTrigger.current !== null && dragSrcTrigger.current !== i) {
                      setForm((f) => ({ ...f, escalationTriggers: reorder(f.escalationTriggers, dragSrcTrigger.current!, i) }));
                    }
                    dragSrcTrigger.current = null;
                    setDragOverTriggerIdx(null);
                  }}
                  onDragEnd={() => { dragSrcTrigger.current = null; setDragOverTriggerIdx(null); }}
                  className={`mb-3 flex flex-wrap items-end gap-2 rounded border p-2 transition-colors ${dragOverTriggerIdx === i ? "border-primary bg-primary/5" : "border-transparent"}`}
                >
                  <span className="cursor-grab self-center select-none text-gray-400" title="Drag to reorder">
                    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                      <circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
                      <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                      <circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
                    </svg>
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      Trigger text <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Keyword or phrase that means &quot;escalate&quot; (e.g. electrical smell, refrigerant leak, error code).
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. electrical smell"
                      className="w-48 rounded border px-2 py-1 text-sm"
                      value={t.trigger}
                      onChange={(ev) => updateTrigger(i, "trigger", ev.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                    <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                      Reason <span className="text-muted" aria-hidden>ⓘ</span>
                      <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                        Why we escalate when this trigger is mentioned (e.g. &quot;Potential electrical hazard&quot;). Shown to the user.
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Potential electrical hazard"
                      className="w-full rounded border px-2 py-1 text-sm"
                      value={t.reason}
                      onChange={(ev) => updateTrigger(i, "reason", ev.target.value)}
                    />
                  </div>
                  <button type="button" onClick={() => removeTrigger(i)} className="text-red-600 text-sm shrink-0">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addTrigger} className="text-sm text-primary hover:underline">
                Add trigger
              </button>
            </div>
          )}

          {activeTab === "steps" && (
            <div>
              <p className="mb-2 text-sm text-muted">Resolution steps</p>
              <p className="mb-3 text-xs text-muted">
                <span className="group/tip relative inline cursor-help border-b border-dotted border-gray-400">
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
                    draggable
                    onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; dragSrcStep.current = index; }}
                    onDragOver={(ev) => { ev.preventDefault(); setDragOverStepIdx(index); }}
                    onDragLeave={() => setDragOverStepIdx(null)}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      if (dragSrcStep.current !== null && dragSrcStep.current !== index) {
                        setForm((f) => ({ ...f, steps: reorder(f.steps, dragSrcStep.current!, index) }));
                      }
                      dragSrcStep.current = null;
                      setDragOverStepIdx(null);
                    }}
                    onDragEnd={() => { dragSrcStep.current = null; setDragOverStepIdx(null); }}
                    className={`rounded border p-4 transition-colors ${dragOverStepIdx === index ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="cursor-grab select-none text-gray-400" title="Drag to reorder">
                          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                            <circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
                            <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                            <circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
                          </svg>
                        </span>
                        <span className="text-sm font-medium">Step {index + 1}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mb-2 flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        Step title <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          Short heading for this step (e.g. &quot;Cool hopper to operating range&quot;).
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Cool hopper to operating range"
                        className="w-full rounded border border-border px-2 py-1 text-sm"
                        value={step.title}
                        onChange={(e) => updateStep(index, "title", e.target.value)}
                      />
                    </div>
                    <div className="mb-2 flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        Instruction <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          What the user should do, in full. This is the main text they will see for this step.
                        </span>
                      </label>
                      <textarea
                        placeholder="e.g. Allow the machine time to cool. Hopper should be in the -8°C to -4°C range..."
                        className="w-full rounded border border-border px-2 py-1 text-sm"
                        rows={2}
                        value={step.instruction}
                        onChange={(e) => updateStep(index, "instruction", e.target.value)}
                      />
                    </div>
                    <div className="mb-2 flex flex-col gap-0.5">
                      <label className="group/tip relative inline-block text-xs font-medium text-muted cursor-help">
                        How to verify (optional) <span className="text-muted" aria-hidden>ⓘ</span>
                        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden max-w-sm rounded bg-gray-800 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover/tip:block">
                          How the user can confirm the step worked (e.g. &quot;Hopper display shows -8°C to -4°C&quot;).
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Hopper display shows temperature within range"
                        className="w-full rounded border border-border px-2 py-1 text-sm"
                        value={step.check ?? ""}
                        onChange={(e) => updateStep(index, "check", e.target.value)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={addStep}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Add step
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={savePlaybook}
              disabled={saving}
              className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:opacity-50"
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
                  enabled: false,
                  productTypeIds: [],
                  steps: [],
                  symptoms: [],
                  evidenceChecklist: [],
                  candidateCauses: [],
                  escalationTriggers: [],
                });
              }}
              className="rounded border border-border px-4 py-2"
            >
              Cancel
            </button>
            <span
              className={`flex items-center gap-1.5 text-sm font-medium text-emerald-600 transition-opacity duration-300 ${
                savedFeedback ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              aria-live="polite"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="8" cy="8" r="7"/>
                <polyline points="5,8.5 7,10.5 11,6"/>
              </svg>
              Saved
            </span>
          </div>
        </div>
        </div>
      )}

      {!dedicatedMode && (
        <>
          {totalPlaybooks > 0 && (
            <div className="mb-4 text-right text-sm text-muted">
              {(() => {
                const from = (page - 1) * PAGE_SIZE + 1;
                const to = Math.min(page * PAGE_SIZE, totalPlaybooks);
                return `Showing ${from}-${to} of ${totalPlaybooks} playbook${totalPlaybooks === 1 ? "" : "s"}`;
              })()}
            </div>
          )}

          <ul className="space-y-2">
            {paginatedPlaybooks.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border border-border bg-surface p-4"
              >
                <div>
                  <Link href={`/admin/playbooks/${p.id}`} className="font-medium text-primary hover:underline">
                    {p.title}
                  </Link>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {p.enabled ? "Enabled" : "Disabled"}
                  </span>
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
                  <button
                    onClick={() => togglePlaybookEnabled(p)}
                    disabled={togglingId === p.id}
                    className="rounded border border-border px-3 py-1 text-sm"
                  >
                    {togglingId === p.id ? "Saving…" : p.enabled ? "Disable" : "Enable"}
                  </button>
                  <a
                    href={`/api/admin/playbooks/${p.id}/export`}
                    download
                    className="rounded border border-border px-3 py-1 text-sm"
                  >
                    Export Excel
                  </a>
                  <Link
                    href={`/admin/playbooks/${p.id}`}
                    className="rounded border border-border px-3 py-1 text-sm"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(p)}
                    disabled={deletingId === p.id}
                    className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === p.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {totalPlaybooks === 0 && (
            <p className="py-6 text-center text-sm text-muted">No playbooks yet.</p>
          )}

          {totalPlaybooks > 0 && (
            <div className="mt-4 flex flex-col items-center gap-2">
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={!canGoPrev}
                    aria-label="First page"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={!canGoPrev}
                    aria-label="Previous page"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ‹
                  </button>

                  {(() => {
                    const pages: (number | "...")[] = [];
                    const total = totalPages;
                    const current = page;
                    if (total <= 7) {
                      for (let i = 1; i <= total; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (current > 3) pages.push("...");
                      const start = Math.max(2, current - 1);
                      const end = Math.min(total - 1, current + 1);
                      for (let i = start; i <= end; i++) pages.push(i);
                      if (current < total - 2) pages.push("...");
                      pages.push(total);
                    }
                    return pages.map((p, idx) =>
                      p === "..." ? (
                        <span key={`ellipsis-${idx}`} className="flex h-8 w-8 items-center justify-center text-sm text-muted">
                          ...
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPage(p as number)}
                          aria-label={`Page ${p}`}
                          aria-current={p === current ? "page" : undefined}
                          className={`flex h-8 min-w-[2rem] items-center justify-center rounded-md border px-2 text-sm transition-colors ${
                            p === current
                              ? "border-primary bg-primary text-white"
                              : "border-border bg-surface text-ink hover:bg-page"
                          }`}
                        >
                          {p}
                        </button>
                      )
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => setPage((prev) => prev + 1)}
                    disabled={!canGoNext}
                    aria-label="Next page"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ›
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={!canGoNext}
                    aria-label="Last page"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink transition-colors hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    »
                  </button>
                </div>
              )}
              <p className="text-sm text-muted">
                {(() => {
                  const from = (page - 1) * PAGE_SIZE + 1;
                  const to = Math.min(page * PAGE_SIZE, totalPlaybooks);
                  return `Showing ${from}-${to} of ${totalPlaybooks} playbook${totalPlaybooks === 1 ? "" : "s"}`;
                })()}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
