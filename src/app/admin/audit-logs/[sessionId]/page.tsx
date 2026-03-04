"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type AuditEntry = {
  id: string;
  sessionId: string;
  turnNumber: number;
  payload: {
    userInput?: {
      message?: string;
      imagePaths?: string[];
    };
    sessionStateBefore?: {
      phase?: string;
      turnCount?: number;
      status?: string;
    };
    sessionStateAfter?: {
      phase?: string;
      turnCount?: number;
      status?: string;
    };
    phasePath?: string[];
    phaseTransition?: string | null;
    llmCalls?: {
      name?: string;
      model?: string;
      systemPrompt?: string;
      userPrompt?: string;
      rawResponse?: string;
      tokensUsed?: unknown;
      durationMs?: number;
    }[];
    ragRetrieval?: {
      query?: string;
      chunksReturned?: number;
      chunkIds?: string[];
      topSimilarity?: number;
    }[];
    plannerOutput?: unknown;
    sanitizedOutput?: unknown;
    sanitizationErrors?: string[];
    apiResponse?: unknown;
    errors?: string[];
    durationMs?: number;
  };
  createdAt: string;
};

type AuditDetailResponse = {
  session: {
    id: string;
    machineModel?: string | null;
    serialNumber?: string | null;
    productType?: string | null;
    status?: string | null;
    phase?: string | null;
    playbookId?: string | null;
    playbookTitle?: string | null;
    turnCount?: number | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  logs: AuditEntry[];
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toImageUrl(sessionId: string, rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  const prefix = `diagnostic_sessions/${sessionId}/`;
  const filename = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  const encoded = filename
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/api/admin/audit-logs/${sessionId}/image/${encoded}`;
}

export default function AdminAuditDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params?.sessionId as string | undefined;
  const [data, setData] = useState<AuditDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/admin/audit-logs/${sessionId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load audit details.");
        return r.json();
      })
      .then((json) => setData(json))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load audit details."))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (lightbox.images.length <= 1) return;
      if (e.key === "ArrowLeft")
        setLightbox((prev) =>
          prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
        );
      if (e.key === "ArrowRight")
        setLightbox((prev) =>
          prev && prev.index < prev.images.length - 1
            ? { ...prev, index: prev.index + 1 }
            : prev
        );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  const logs = useMemo(() => data?.logs ?? [], [data]);

  async function handleDelete(): Promise<void> {
    if (!sessionId || deleting) return;
    if (
      !confirm(
        "Delete this audit session and all associated uploaded files? This cannot be undone."
      )
    ) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/audit-logs/${sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to delete audit session.");
      }
      router.push("/admin/audit-logs");
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete audit session.");
      setDeleting(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading audit details...</p>;
  if (error || !data) return <p className="text-sm text-red-600">{error ?? "Not found."}</p>;

  const session = data.session;
  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          href="/admin/audit-logs"
          className="text-sm text-muted hover:text-ink"
        >
          ← Back to audit logs
        </Link>
        <Button
          variant="danger"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? "Deleting..." : "Delete session"}
        </Button>
      </div>
      {deleteError && <p className="mb-4 text-sm text-red-600">{deleteError}</p>}

      <Card className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Session audit</h1>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-muted md:grid-cols-2">
          <div><strong className="text-ink">Session ID:</strong> {session.id}</div>
          <div><strong className="text-ink">Status:</strong> {session.status ?? "-"}</div>
          <div><strong className="text-ink">Phase:</strong> {session.phase ?? "-"}</div>
          <div><strong className="text-ink">Turn count:</strong> {session.turnCount ?? "-"}</div>
          <div><strong className="text-ink">Machine model:</strong> {session.machineModel ?? "-"}</div>
          <div><strong className="text-ink">Serial number:</strong> {session.serialNumber ?? "-"}</div>
          <div><strong className="text-ink">Product type:</strong> {session.productType ?? "-"}</div>
          <div>
            <strong className="text-ink">Playbook:</strong>{" "}
            {session.playbookId ? (
              <Link
                href={`/admin/playbooks/${session.playbookId}`}
                className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
              >
                {session.playbookTitle ?? session.playbookId}
              </Link>
            ) : (
              "-"
            )}
          </div>
          <div><strong className="text-ink">Created:</strong> {formatDate(session.createdAt)}</div>
          <div><strong className="text-ink">Updated:</strong> {formatDate(session.updatedAt)}</div>
        </div>
      </Card>

      <section className="space-y-4">
        {logs.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No audit entries for this session.</p>
          </Card>
        ) : (
          logs.map((entry) => (
            <details
              key={entry.id}
              open={entry.turnNumber === logs[logs.length - 1]?.turnNumber}
              className="rounded-card border border-border bg-surface p-4 shadow-card"
            >
              <summary className="cursor-pointer font-medium text-ink">
                Turn {entry.turnNumber} • {formatDate(entry.createdAt)}
              </summary>

              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <h3 className="font-semibold text-ink">User input</h3>
                  <p className="mt-1 whitespace-pre-wrap text-muted">
                    {entry.payload.userInput?.message || "(empty)"}
                  </p>
                  {(entry.payload.userInput?.imagePaths ?? []).length > 0 && (() => {
                    const imagePaths = entry.payload.userInput!.imagePaths!;
                    const imageUrls = imagePaths.map((p) => toImageUrl(entry.sessionId, p));
                    return (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {imageUrls.map((url, idx) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setLightbox({ images: imageUrls, index: idx })}
                            className="block cursor-pointer rounded border border-border transition-opacity hover:opacity-90"
                          >
                            <Image
                              src={url}
                              alt={`Uploaded photo ${idx + 1} of ${imageUrls.length}`}
                              width={96}
                              height={96}
                              unoptimized
                              className="h-24 w-24 rounded object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-1 gap-2 text-muted md:grid-cols-2">
                  <div><strong className="text-ink">Phase path:</strong> {(entry.payload.phasePath ?? []).join(" -> ") || "-"}</div>
                  <div><strong className="text-ink">Phase transition:</strong> {entry.payload.phaseTransition ?? "-"}</div>
                  <div><strong className="text-ink">Duration:</strong> {entry.payload.durationMs ?? "-"} ms</div>
                  <div><strong className="text-ink">Sanitization errors:</strong> {(entry.payload.sanitizationErrors ?? []).length}</div>
                </div>

                <details className="rounded border border-border p-3">
                  <summary className="cursor-pointer font-semibold text-ink">
                    LLM calls ({entry.payload.llmCalls?.length ?? 0})
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {prettyJson(entry.payload.llmCalls ?? [])}
                  </pre>
                </details>

                <details className="rounded border border-border p-3">
                  <summary className="cursor-pointer font-semibold text-ink">RAG retrieval</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {prettyJson(entry.payload.ragRetrieval ?? [])}
                  </pre>
                </details>

                <details className="rounded border border-border p-3">
                  <summary className="cursor-pointer font-semibold text-ink">Planner output</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {prettyJson(entry.payload.plannerOutput)}
                  </pre>
                </details>

                <details className="rounded border border-border p-3">
                  <summary className="cursor-pointer font-semibold text-ink">Sanitized output</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {prettyJson(entry.payload.sanitizedOutput)}
                  </pre>
                </details>

                <details className="rounded border border-border p-3">
                  <summary className="cursor-pointer font-semibold text-ink">API response payload</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {prettyJson(entry.payload.apiResponse)}
                  </pre>
                </details>

                {(entry.payload.errors ?? []).length > 0 && (
                  <div className="rounded border border-red-300 bg-red-50 p-3 text-red-700">
                    <strong>Errors:</strong>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">
                      {prettyJson(entry.payload.errors)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          ))
        )}
      </section>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative flex max-h-[90vh] max-w-[90vw] items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute -right-3 -top-3 z-10 rounded-full bg-surface p-1.5 shadow-lg hover:bg-aqua/30"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-ink"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {lightbox.images.length > 1 && (
              <button
                type="button"
                disabled={lightbox.index === 0}
                onClick={() =>
                  setLightbox((prev) =>
                    prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
                  )
                }
                className="mr-3 shrink-0 rounded-full bg-surface/90 p-2 shadow-lg transition-opacity hover:bg-surface disabled:opacity-30"
                aria-label="Previous image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-ink"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}

            <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.images[lightbox.index]}
                alt={`Audit image ${lightbox.index + 1} of ${lightbox.images.length}`}
                className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain shadow-2xl"
              />
              {lightbox.images.length > 1 && (
                <span className="mt-3 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
                  {lightbox.index + 1} / {lightbox.images.length}
                </span>
              )}
            </div>

            {lightbox.images.length > 1 && (
              <button
                type="button"
                disabled={lightbox.index === lightbox.images.length - 1}
                onClick={() =>
                  setLightbox((prev) =>
                    prev && prev.index < prev.images.length - 1
                      ? { ...prev, index: prev.index + 1 }
                      : prev
                  )
                }
                className="ml-3 shrink-0 rounded-full bg-surface/90 p-2 shadow-lg transition-opacity hover:bg-surface disabled:opacity-30"
                aria-label="Next image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-ink"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
