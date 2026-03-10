"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useAdminRole } from "@/app/admin/AdminSidebarProvider";
import { PlaybookGuideModal } from "./PlaybookGuideModal";
import { ActionQuickEditModal, LabelQuickEditModal } from "./V2EditorControls";
import { PlaybookEditorPanel, formatValidationIssueSummary } from "./PlaybookEditorPanel";
import { PLAYBOOK_TABS, type Action, type PlaybookTab } from "./types";
import { usePlaybookAdminData } from "./usePlaybookAdminData";
import { usePlaybookEditorState } from "./usePlaybookEditorState";

const PAGE_SIZE = 20;

function parseTabFromParams(searchParams: ReturnType<typeof useSearchParams>): PlaybookTab {
  const tab = searchParams.get("tab");
  return tab && PLAYBOOK_TABS.includes(tab as PlaybookTab) ? (tab as PlaybookTab) : "overview";
}

export default function AdminPlaybooksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ id?: string }>();
  const focusPlaybookId = params?.id;
  const dedicatedMode = Boolean(focusPlaybookId);
  const adminRole = useAdminRole();
  const showSchemaVersion = adminRole === "admin";

  const {
    labels,
    productTypes,
    actionsList,
    playbooks,
    loading,
    error,
    targetMissing,
    reload,
    setPlaybooks,
    setLabels,
    setActionsList,
  } = usePlaybookAdminData(focusPlaybookId);

  const {
    editing,
    showForm,
    form,
    setForm,
    saving,
    saveMsg,
    setSaveMsg,
    validationIssues,
    labelsById,
    actionsById,
    getIssuesForPrefix,
    startNew,
    startEditing,
    closeForm,
    savePlaybook,
  } = usePlaybookEditorState({
    actionsList,
    labels,
    dedicatedMode,
  });

  const [activeTab, setActiveTab] = useState<PlaybookTab>(() => parseTabFromParams(searchParams));
  const [guideOpen, setGuideOpen] = useState(false);
  const [helpExpanded, setHelpExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("playbook-help-expanded") !== "false";
  });
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [actionModalMode, setActionModalMode] = useState<"create" | "edit" | null>(null);
  const [actionModalTargetId, setActionModalTargetId] = useState<string | null>(null);
  const [actionModalEvidenceIndex, setActionModalEvidenceIndex] = useState<number | null>(null);
  const [labelModalMode, setLabelModalMode] = useState<"create" | "edit" | null>(null);
  const [labelModalTargetId, setLabelModalTargetId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(parseTabFromParams(searchParams));
  }, [searchParams]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(playbooks.length / PAGE_SIZE));
    setPage((current) => Math.min(current, maxPage));
  }, [playbooks.length]);

  useEffect(() => {
    if (!focusPlaybookId) return;
    const match = playbooks.find((playbook) => playbook.id === focusPlaybookId);
    if (!match) return;
    if (!editing || editing.id !== match.id || editing.updatedAt !== match.updatedAt) {
      startEditing(match);
    }
  }, [editing, focusPlaybookId, playbooks, startEditing]);

  useEffect(() => {
    return () => {
      if (savedFeedbackTimer.current) clearTimeout(savedFeedbackTimer.current);
    };
  }, []);

  const setActiveTabWithUrl = (tab: PlaybookTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const toggleHelp = () => {
    setHelpExpanded((previous) => {
      const next = !previous;
      localStorage.setItem("playbook-help-expanded", String(next));
      return next;
    });
  };

  const totalPages = Math.ceil(playbooks.length / PAGE_SIZE);
  const paginatedPlaybooks = useMemo(
    () => playbooks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, playbooks]
  );
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const validationSummary = useMemo(
    () =>
      validationIssues.slice(0, 12).map((issue) => ({
        label: formatValidationIssueSummary(issue.path, form),
        message: issue.message,
      })),
    [form, validationIssues]
  );

  const handleSave = async () => {
    const saved = await savePlaybook();
    if (!saved) return;

    setPlaybooks((current) => {
      const index = current.findIndex((item) => item.id === saved.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = saved;
        return next;
      }
      return [...current, saved];
    });
    if (savedFeedbackTimer.current) clearTimeout(savedFeedbackTimer.current);
    setSavedFeedback(true);
    savedFeedbackTimer.current = setTimeout(() => setSavedFeedback(false), 2500);
  };

  const handleImport = async (files: FileList) => {
    setImporting(true);
    setImportMsg(null);
    const succeeded: string[] = [];
    const failed: { name: string; error: string }[] = [];

    for (const file of Array.from(files)) {
      try {
        const data = new FormData();
        data.append("file", file);
        const response = await fetch("/api/admin/playbooks/import", {
          method: "POST",
          body: data,
        });
        const payload = await response.json();
        if (!response.ok) {
          failed.push({ name: file.name, error: payload.error ?? "Import failed" });
          continue;
        }
        setPlaybooks((current) => {
          const index = current.findIndex((item) => item.id === payload.id);
          if (index >= 0) {
            const next = [...current];
            next[index] = payload;
            return next;
          }
          return [...current, payload];
        });
        succeeded.push(payload.title || file.name);
      } catch {
        failed.push({ name: file.name, error: "Failed to upload file." });
      }
    }

    const parts: string[] = [];
    if (succeeded.length > 0) {
      parts.push(
        succeeded.length === 1
          ? `Imported "${succeeded[0]}" successfully.`
          : `Imported ${succeeded.length} playbooks successfully.`
      );
    }
    if (failed.length > 0) {
      parts.push(failed.map((item) => `${item.name}: ${item.error}`).join("\n"));
    }
    setImportMsg({
      type: failed.length > 0 ? "error" : "success",
      text: parts.join("\n\n"),
    });
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (playbookId: string, title: string) => {
    if (!confirm(`Delete playbook "${title}"? This cannot be undone.`)) return;
    setDeleteError(null);
    setDeletingId(playbookId);
    try {
      const response = await fetch(`/api/admin/playbooks/${playbookId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeleteError(payload.error ?? "Delete failed");
        return;
      }
      setPlaybooks((current) => current.filter((item) => item.id !== playbookId));
      if (editing?.id === playbookId) {
        closeForm();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const togglePlaybookEnabled = async (playbookId: string, enabled: boolean) => {
    setTogglingId(playbookId);
    setSaveMsg(null);
    try {
      const response = await fetch(`/api/admin/playbooks/${playbookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSaveMsg(payload.error ?? "Failed to update playbook status.");
        return;
      }
      setPlaybooks((current) => current.map((item) => (item.id === payload.id ? { ...item, ...payload } : item)));
      if (editing?.id === payload.id) {
        startEditing({ ...editing, ...payload });
      }
      setSaveMsg(payload.enabled ? "Playbook enabled for diagnosis triage." : "Playbook disabled for diagnosis triage.");
    } finally {
      setTogglingId(null);
    }
  };

  const handleActionSaved = (savedAction: Action) => {
    setActionsList((current) => {
      const index = current.findIndex((action) => action.id === savedAction.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = savedAction;
        return next;
      }
      return [...current, savedAction].sort((a, b) => a.title.localeCompare(b.title));
    });
    if (actionModalEvidenceIndex !== null) {
      setForm((current) => ({
        ...current,
        evidenceChecklist: current.evidenceChecklist.map((item, index) =>
          index === actionModalEvidenceIndex ? { ...item, actionId: savedAction.id } : item
        ),
      }));
    }
  };

  const handleLabelSaved = (savedLabel: { id: string; displayName: string; description?: string | null }) => {
    setLabels((current) => {
      const index = current.findIndex((label) => label.id === savedLabel.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = savedLabel;
        return next;
      }
      return [...current, savedLabel].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
    setForm((current) => ({ ...current, labelId: savedLabel.id }));
  };

  const currentActionTarget =
    actionModalMode === "edit" && actionModalTargetId ? actionsById.get(actionModalTargetId) ?? null : null;
  const currentLabelTarget =
    labelModalMode === "edit" && labelModalTargetId ? labelsById.get(labelModalTargetId) ?? null : null;

  if (loading) return <LoadingScreen />;

  if (error) {
    return (
      <div>
        <PageHeader
          title={dedicatedMode ? "Edit playbook" : "Playbooks"}
          actions={
            <div className="flex items-center gap-4">
              {dedicatedMode ? <Link href="/admin/playbooks" className="text-primary hover:underline">← Back to playbooks</Link> : null}
              <Link href="/admin" className="text-primary hover:underline">← Dashboard</Link>
            </div>
          }
        />
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Failed to load playbook admin data.</p>
          <p className="mt-1">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-3 rounded border border-red-300 px-3 py-2 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={dedicatedMode ? "Edit playbook" : "Playbooks"}
        actions={
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1 text-sm text-muted transition-colors hover:border-primary hover:text-primary"
            >
              Playbook Guide
            </button>
            {editing ? (
              <a
                href={`/api/admin/playbooks/${editing.id}/export`}
                download
                className="rounded border border-border px-3 py-1 text-sm"
              >
                Export Excel
              </a>
            ) : null}
            {dedicatedMode ? (
              <Link href="/admin/playbooks" className="text-primary hover:underline">
                ← Back to playbooks
              </Link>
            ) : null}
            <Link href="/admin" className="text-primary hover:underline">
              ← Dashboard
            </Link>
          </div>
        }
      />

      <PlaybookGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} scrollToTab={activeTab} />

      {!dedicatedMode ? (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={startNew} className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-hover">
              New playbook
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="rounded border border-primary px-4 py-2 text-primary hover:bg-aqua/30 disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import from Excel…"}
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
              multiple
              className="hidden"
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) handleImport(files);
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Workbook import/export is the advanced bulk-edit path. The in-app editor is now the primary schema-v2 authoring surface for evidence contracts, causes, and structured rules.
          </p>
        </div>
      ) : null}

      {saveMsg ? (
        <div className="mb-4 flex items-center justify-between gap-2 rounded bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <span>{saveMsg}</span>
          <button onClick={() => setSaveMsg(null)} className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100">
            ×
          </button>
        </div>
      ) : null}

      {validationIssues.length > 0 ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Validation issues</p>
          <ul className="mt-2 list-disc pl-5">
            {validationSummary.map((issue) => (
              <li key={`${issue.label}-${issue.message}`}>
                <span className="font-medium">{issue.label}</span>: {issue.message}
              </li>
            ))}
          </ul>
          {validationIssues.length > 12 ? <p className="mt-2 text-xs">Showing the first 12 issues.</p> : null}
        </div>
      ) : null}

      {importMsg ? (
        <div
          className={`mb-4 rounded px-4 py-3 text-sm ${
            importMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="whitespace-pre-wrap">{importMsg.text}</span>
            <button onClick={() => setImportMsg(null)} className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100">
              ×
            </button>
          </div>
        </div>
      ) : null}

      {deleteError ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {deleteError}
        </div>
      ) : null}

      {targetMissing && dedicatedMode ? (
        <div className="rounded border border-accent/30 bg-accent/10 p-3 text-sm text-ink">
          Playbook not found. It may have been deleted.
        </div>
      ) : null}

      {(dedicatedMode ? Boolean(editing) : editing || showForm) ? (
        <div className={dedicatedMode ? "xl:max-w-[55%]" : undefined}>
          <PlaybookEditorPanel
            editing={editing}
            form={form}
            setForm={setForm}
            activeTab={activeTab}
            setActiveTab={setActiveTabWithUrl}
            labels={labels}
            productTypes={productTypes}
            actionsList={actionsList}
            actionsById={actionsById}
            helpExpanded={helpExpanded}
            toggleHelp={toggleHelp}
            showSchemaVersion={showSchemaVersion}
            getIssuesForPrefix={getIssuesForPrefix}
            onOpenCreateActionModal={(evidenceIndex) => {
              setActionModalMode("create");
              setActionModalTargetId(null);
              setActionModalEvidenceIndex(typeof evidenceIndex === "number" ? evidenceIndex : null);
            }}
            onOpenEditActionModal={(actionId, evidenceIndex) => {
              if (!actionId) return;
              setActionModalMode("edit");
              setActionModalTargetId(actionId);
              setActionModalEvidenceIndex(typeof evidenceIndex === "number" ? evidenceIndex : null);
            }}
            onOpenCreateLabelModal={() => {
              setLabelModalMode("create");
              setLabelModalTargetId(null);
            }}
            onOpenEditLabelModal={(labelId) => {
              if (!labelId) return;
              setLabelModalMode("edit");
              setLabelModalTargetId(labelId);
            }}
            onSave={handleSave}
            onCancel={() => {
              if (dedicatedMode) {
                router.push("/admin/playbooks");
                return;
              }
              closeForm();
            }}
            saving={saving}
            savedFeedback={savedFeedback}
          />
        </div>
      ) : null}

      {!dedicatedMode ? (
        <>
          {playbooks.length > 0 ? (
            <div className="mb-4 text-right text-sm text-muted">
              {`${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, playbooks.length)} of ${playbooks.length} playbook${playbooks.length === 1 ? "" : "s"}`}
            </div>
          ) : null}

          <ul className="space-y-2">
            {paginatedPlaybooks.map((playbook) => (
              <li
                key={playbook.id}
                className="flex items-center justify-between rounded border border-border bg-surface p-4"
              >
                <div>
                  <Link href={`/admin/playbooks/${playbook.id}`} className="font-medium text-primary hover:underline">
                    {playbook.title}
                  </Link>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                      playbook.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {playbook.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <span className="ml-2 text-sm text-gray-500">
                    ({labels.find((item) => item.id === playbook.labelId)?.displayName ?? playbook.labelId})
                  </span>
                  <p className="text-sm text-gray-500">
                    {Array.isArray(playbook.steps) ? playbook.steps.length : 0} steps
                    {Array.isArray(playbook.symptoms) && playbook.symptoms.length > 0 ? `, ${playbook.symptoms.length} symptoms` : ""}
                    {Array.isArray(playbook.evidenceChecklist) && playbook.evidenceChecklist.length > 0 ? `, ${playbook.evidenceChecklist.length} evidence` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => togglePlaybookEnabled(playbook.id, playbook.enabled)}
                    disabled={togglingId === playbook.id}
                    className="rounded border border-border px-3 py-1 text-sm"
                  >
                    {togglingId === playbook.id ? "Saving…" : playbook.enabled ? "Disable" : "Enable"}
                  </button>
                  <a
                    href={`/api/admin/playbooks/${playbook.id}/export`}
                    download
                    className="rounded border border-border px-3 py-1 text-sm"
                  >
                    Export Excel
                  </a>
                  <Link href={`/admin/playbooks/${playbook.id}`} className="rounded border border-border px-3 py-1 text-sm">
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(playbook.id, playbook.title)}
                    disabled={deletingId === playbook.id}
                    className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === playbook.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {playbooks.length === 0 ? <p className="py-6 text-center text-sm text-muted">No playbooks yet.</p> : null}

          {playbooks.length > 0 && totalPages > 1 ? (
            <div className="mt-4 flex flex-col items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={!canGoPrev}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink disabled:opacity-40"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={!canGoPrev}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink disabled:opacity-40"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={!canGoNext}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink disabled:opacity-40"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={!canGoNext}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-sm text-ink disabled:opacity-40"
                >
                  »
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <ActionQuickEditModal
        open={actionModalMode !== null}
        mode={actionModalMode ?? "create"}
        action={currentActionTarget}
        onClose={() => {
          setActionModalMode(null);
          setActionModalTargetId(null);
          setActionModalEvidenceIndex(null);
        }}
        onSaved={handleActionSaved}
      />

      <LabelQuickEditModal
        open={labelModalMode !== null}
        mode={labelModalMode ?? "create"}
        label={currentLabelTarget}
        onClose={() => {
          setLabelModalMode(null);
          setLabelModalTargetId(null);
        }}
        onSaved={handleLabelSaved}
      />
    </div>
  );
}
