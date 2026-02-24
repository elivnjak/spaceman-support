"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
  const sessionId = params?.sessionId as string | undefined;
  const [data, setData] = useState<AuditDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  if (loading) return <p className="text-sm text-gray-600 dark:text-gray-300">Loading audit details...</p>;
  if (error || !data) return <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Not found."}</p>;

  const session = data.session;
  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/audit-logs"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← Back to audit logs
        </Link>
      </div>

      <header className="mb-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Session audit</h1>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-gray-700 dark:text-gray-300 md:grid-cols-2">
          <div><strong>Session ID:</strong> {session.id}</div>
          <div><strong>Status:</strong> {session.status ?? "-"}</div>
          <div><strong>Phase:</strong> {session.phase ?? "-"}</div>
          <div><strong>Turn count:</strong> {session.turnCount ?? "-"}</div>
          <div><strong>Machine model:</strong> {session.machineModel ?? "-"}</div>
          <div><strong>Serial number:</strong> {session.serialNumber ?? "-"}</div>
          <div><strong>Product type:</strong> {session.productType ?? "-"}</div>
          <div><strong>Playbook ID:</strong> {session.playbookId ?? "-"}</div>
          <div><strong>Created:</strong> {formatDate(session.createdAt)}</div>
          <div><strong>Updated:</strong> {formatDate(session.updatedAt)}</div>
        </div>
      </header>

      <section className="space-y-4">
        {logs.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            No audit entries for this session.
          </p>
        ) : (
          logs.map((entry) => (
            <details
              key={entry.id}
              open={entry.turnNumber === logs[logs.length - 1]?.turnNumber}
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
            >
              <summary className="cursor-pointer font-medium text-gray-900 dark:text-white">
                Turn {entry.turnNumber} • {formatDate(entry.createdAt)}
              </summary>

              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">User input</h3>
                  <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">
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
                            className="block cursor-pointer rounded border border-gray-300 transition-opacity hover:opacity-90 dark:border-gray-600"
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

                <div className="grid grid-cols-1 gap-2 text-gray-700 dark:text-gray-300 md:grid-cols-2">
                  <div><strong>Phase path:</strong> {(entry.payload.phasePath ?? []).join(" -> ") || "-"}</div>
                  <div><strong>Phase transition:</strong> {entry.payload.phaseTransition ?? "-"}</div>
                  <div><strong>Duration:</strong> {entry.payload.durationMs ?? "-"} ms</div>
                  <div><strong>Sanitization errors:</strong> {(entry.payload.sanitizationErrors ?? []).length}</div>
                </div>

                <details className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">
                    LLM calls ({entry.payload.llmCalls?.length ?? 0})
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {prettyJson(entry.payload.llmCalls ?? [])}
                  </pre>
                </details>

                <details className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">RAG retrieval</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {prettyJson(entry.payload.ragRetrieval ?? [])}
                  </pre>
                </details>

                <details className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">Planner output</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {prettyJson(entry.payload.plannerOutput)}
                  </pre>
                </details>

                <details className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">Sanitized output</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {prettyJson(entry.payload.sanitizedOutput)}
                  </pre>
                </details>

                <details className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <summary className="cursor-pointer font-semibold text-gray-900 dark:text-white">API response payload</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {prettyJson(entry.payload.apiResponse)}
                  </pre>
                </details>

                {(entry.payload.errors ?? []).length > 0 && (
                  <div className="rounded border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
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
              className="absolute -right-3 -top-3 z-10 rounded-full bg-white p-1.5 shadow-lg hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-gray-700 dark:text-gray-200"
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
                className="mr-3 shrink-0 rounded-full bg-white/90 p-2 shadow-lg transition-opacity hover:bg-white disabled:opacity-30 dark:bg-gray-700/90 dark:hover:bg-gray-600"
                aria-label="Previous image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-gray-800 dark:text-gray-200"
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
                className="ml-3 shrink-0 rounded-full bg-white/90 p-2 shadow-lg transition-opacity hover:bg-white disabled:opacity-30 dark:bg-gray-700/90 dark:hover:bg-gray-600"
                aria-label="Next image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-gray-800 dark:text-gray-200"
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
