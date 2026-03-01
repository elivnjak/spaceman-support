"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type TicketStatus = "open" | "in_progress" | "waiting" | "closed";

type TicketNote = {
  id: string;
  sessionId: string;
  authorId: string;
  authorEmail: string | null;
  content: string;
  createdAt: string | null;
};

type TicketDetailResponse = {
  session: {
    id: string;
    status: string | null;
    ticketStatus: string | null;
    userName: string | null;
    userPhone: string | null;
    machineModel: string | null;
    serialNumber: string | null;
    productType: string | null;
    manufacturingYear: number | null;
    phase: string | null;
    turnCount: number | null;
    playbookId: string | null;
    escalationReason: string | null;
    resolutionOutcome: string | null;
    messages: unknown;
    evidence: unknown;
    hypotheses: unknown;
    createdAt: string | null;
    updatedAt: string | null;
  };
  notes: TicketNote[];
  currentUser: {
    id: string;
    email: string;
    role: string;
  } | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images: string[];
  guideImages: string[];
  resolution: {
    diagnosis: string | null;
    why: string | null;
    steps: string[];
  } | null;
  escalationReason: string | null;
};

const TICKET_STATUS_OPTIONS: Array<{ value: TicketStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "closed", label: "Closed" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "-";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type EvidenceDisplay = {
  value: string;
  type: string | null;
  confidence: string | null;
  collectedAt: string | null;
  turn: string | null;
  photoAnalysis: string | null;
};

function toEvidenceDisplay(value: unknown): EvidenceDisplay {
  if (!isRecord(value)) {
    return {
      value: toStringValue(value),
      type: null,
      confidence: null,
      collectedAt: null,
      turn: null,
      photoAnalysis: null,
    };
  }

  const type = typeof value.type === "string" ? value.type : null;
  const confidence = typeof value.confidence === "string" ? value.confidence : null;
  const collectedAt = typeof value.collectedAt === "string" ? value.collectedAt : null;
  const turn =
    typeof value.turn === "number" || typeof value.turn === "string"
      ? String(value.turn)
      : null;
  const photoAnalysis =
    typeof value.photoAnalysis === "string" ? value.photoAnalysis : null;

  return {
    value: "value" in value ? toStringValue(value.value) : toStringValue(value),
    type,
    confidence,
    collectedAt,
    turn,
    photoAnalysis,
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleString(undefined, { hour12: true });
}

function ticketStatusBadgeClass(status: string | null): string {
  if (status === "in_progress") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  }
  if (status === "waiting") {
    return "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  }
  if (status === "closed") {
    return "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
}

function ticketStatusLabel(status: string | null): string {
  if (status === "in_progress") return "In progress";
  if (status === "waiting") return "Waiting";
  if (status === "closed") return "Closed";
  return "Open";
}

function toSessionImageUrl(sessionId: string, rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  const marker = `diagnostic_sessions/${sessionId}/`;
  const markerIndex = normalized.indexOf(marker);
  const filePath =
    markerIndex >= 0
      ? normalized.slice(markerIndex + marker.length)
      : normalized.replace(/^\/+/, "");
  const encoded = filePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/api/admin/audit-logs/${sessionId}/image/${encoded}`;
}

function resolveImageUrl(sessionId: string, imagePath: string): string {
  if (
    imagePath.startsWith("http://") ||
    imagePath.startsWith("https://") ||
    imagePath.startsWith("blob:") ||
    imagePath.startsWith("/api/admin/audit-logs/")
  ) {
    return imagePath;
  }
  if (imagePath.startsWith("/") && !imagePath.includes(`diagnostic_sessions/${sessionId}/`)) {
    return imagePath;
  }
  return toSessionImageUrl(sessionId, imagePath);
}

function parseChatMessages(sessionId: string, rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.map((item) => {
    const raw = isRecord(item) ? item : {};
    const role = raw.role === "user" ? "user" : "assistant";
    const content = typeof raw.content === "string" ? raw.content : "";
    const images = Array.isArray(raw.images)
      ? raw.images
          .filter((value): value is string => typeof value === "string")
          .map((path) => resolveImageUrl(sessionId, path))
      : [];
    const guideImages = Array.isArray(raw.guideImages)
      ? raw.guideImages
          .filter((value): value is string => typeof value === "string")
          .map((path) => resolveImageUrl(sessionId, path))
      : [];

    const resolution = isRecord(raw.resolution)
      ? {
          diagnosis:
            typeof raw.resolution.diagnosis === "string"
              ? raw.resolution.diagnosis
              : null,
          why: typeof raw.resolution.why === "string" ? raw.resolution.why : null,
          steps: Array.isArray(raw.resolution.steps)
            ? raw.resolution.steps
                .map((step) =>
                  isRecord(step) && typeof step.instruction === "string"
                    ? step.instruction
                    : null
                )
                .filter((value): value is string => Boolean(value))
            : [],
        }
      : null;

    return {
      role,
      content,
      images,
      guideImages,
      resolution,
      escalationReason:
        typeof raw.escalation_reason === "string" ? raw.escalation_reason : null,
    };
  });
}

export default function AdminTicketDetailPage() {
  const params = useParams();
  const sessionId = params?.sessionId as string | undefined;
  const [data, setData] = useState<TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/admin/tickets/${sessionId}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Failed to load ticket details.");
        }
        return response.json() as Promise<TicketDetailResponse>;
      })
      .then((payload) => setData(payload))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load ticket details.")
      )
      .finally(() => setLoading(false));
  }, [sessionId]);

  const parsedMessages = useMemo(
    () => (data ? parseChatMessages(data.session.id, data.session.messages) : []),
    [data]
  );
  const evidenceEntries = useMemo(() => {
    if (!data || !isRecord(data.session.evidence)) return [] as Array<[string, unknown]>;
    return Object.entries(data.session.evidence);
  }, [data]);
  const hypotheses = useMemo(() => {
    if (!data || !Array.isArray(data.session.hypotheses)) return [] as unknown[];
    return data.session.hypotheses;
  }, [data]);

  async function handleTicketStatusChange(nextStatus: TicketStatus): Promise<void> {
    if (!data || !sessionId || statusSaving) return;
    const previousStatus = data.session.ticketStatus;
    setStatusSaving(true);
    setStatusError(null);
    setData((prev) =>
      prev
        ? {
            ...prev,
            session: {
              ...prev.session,
              ticketStatus: nextStatus,
            },
          }
        : prev
    );

    try {
      const response = await fetch(`/api/admin/tickets/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketStatus: nextStatus }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to update ticket status.");
      }
      const updated = (await response.json()) as {
        ticketStatus: string;
        updatedAt: string | null;
      };
      setData((prev) =>
        prev
          ? {
              ...prev,
              session: {
                ...prev.session,
                ticketStatus: updated.ticketStatus,
                updatedAt: updated.updatedAt,
              },
            }
          : prev
      );
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Failed to update ticket status.");
      setData((prev) =>
        prev
          ? {
              ...prev,
              session: {
                ...prev.session,
                ticketStatus: previousStatus,
              },
            }
          : prev
      );
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleAddNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!sessionId || noteSaving) return;

    const content = noteInput.trim();
    if (!content) {
      setNoteError("Please enter a note.");
      return;
    }

    setNoteSaving(true);
    setNoteError(null);
    try {
      const response = await fetch(`/api/admin/tickets/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to add note.");
      }
      const inserted = (await response.json()) as TicketNote;
      setData((prev) =>
        prev
          ? {
              ...prev,
              notes: [inserted, ...prev.notes],
            }
          : prev
      );
      setNoteInput("");
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Failed to add note.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleDeleteNote(noteId: string): Promise<void> {
    if (!sessionId || deletingNoteId) return;
    if (!confirm("Delete this note?")) return;

    setDeletingNoteId(noteId);
    setNoteError(null);
    try {
      const response = await fetch(`/api/admin/tickets/${sessionId}/notes/${noteId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Failed to delete note.");
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              notes: prev.notes.filter((note) => note.id !== noteId),
            }
          : prev
      );
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Failed to delete note.");
    } finally {
      setDeletingNoteId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">Loading ticket details...</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Ticket not found."}</p>;
  }

  const activeTicketStatus = TICKET_STATUS_OPTIONS.some(
    (option) => option.value === data.session.ticketStatus
  )
    ? (data.session.ticketStatus as TicketStatus)
    : "open";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/admin/tickets"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ← Back to tickets
        </Link>
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${ticketStatusBadgeClass(
            data.session.ticketStatus
          )}`}
        >
          {ticketStatusLabel(data.session.ticketStatus)}
        </span>
      </div>

      <header className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Ticket {data.session.id}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Manage session details, transcript, and internal notes.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_1fr]">
        <aside className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <label
              htmlFor="ticket-status"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              Ticket status
            </label>
            <select
              id="ticket-status"
              value={activeTicketStatus}
              onChange={(e) => handleTicketStatusChange(e.target.value as TicketStatus)}
              disabled={statusSaving}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            >
              {TICKET_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {statusError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{statusError}</p>
            )}
          </div>

          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <p><strong>Customer:</strong> {data.session.userName ?? "-"}</p>
            <p><strong>Phone:</strong> {data.session.userPhone ?? "-"}</p>
            <p><strong>Model:</strong> {data.session.machineModel ?? "-"}</p>
            <p><strong>Serial:</strong> {data.session.serialNumber ?? "-"}</p>
            <p><strong>Product type:</strong> {data.session.productType ?? "-"}</p>
            <p><strong>Year:</strong> {data.session.manufacturingYear ?? "-"}</p>
            <p><strong>Session status:</strong> {data.session.status ?? "-"}</p>
            <p><strong>Phase:</strong> {data.session.phase ?? "-"}</p>
            <p><strong>Turn count:</strong> {data.session.turnCount ?? "-"}</p>
            <p><strong>Playbook:</strong> {data.session.playbookId ?? "-"}</p>
            <p><strong>Resolution outcome:</strong> {data.session.resolutionOutcome ?? "-"}</p>
            <p><strong>Escalation reason:</strong> {data.session.escalationReason ?? "-"}</p>
            <p><strong>Created:</strong> {formatDate(data.session.createdAt)}</p>
            <p><strong>Updated:</strong> {formatDate(data.session.updatedAt)}</p>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
              Evidence summary
            </h2>
            {evidenceEntries.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">No evidence captured.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {evidenceEntries.map(([key, value]) => {
                  const display = toEvidenceDisplay(value);
                  return (
                    <li key={key} className="rounded border border-gray-200 p-2 dark:border-gray-700">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{key}</p>
                      <div className="mt-1 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                        <p className="break-words">
                          <span className="font-medium">Value:</span> {display.value}
                        </p>
                        {display.type && (
                          <p>
                            <span className="font-medium">Type:</span> {display.type}
                          </p>
                        )}
                        {display.confidence && (
                          <p>
                            <span className="font-medium">Confidence:</span>{" "}
                            {display.confidence}
                          </p>
                        )}
                        {display.collectedAt && (
                          <p>
                            <span className="font-medium">Collected:</span>{" "}
                            {formatDate(display.collectedAt)}
                          </p>
                        )}
                        {display.turn && (
                          <p>
                            <span className="font-medium">Turn:</span> {display.turn}
                          </p>
                        )}
                        {display.photoAnalysis && (
                          <p className="break-words">
                            <span className="font-medium">Photo analysis:</span>{" "}
                            {display.photoAnalysis}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
              Hypotheses summary
            </h2>
            {hypotheses.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">No hypotheses captured.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {hypotheses.map((item, index) => {
                  const row = isRecord(item) ? item : {};
                  const causeId =
                    typeof row.causeId === "string" ? row.causeId : `Cause ${index + 1}`;
                  const status = typeof row.status === "string" ? row.status : "-";
                  const confidence =
                    typeof row.confidence === "number"
                      ? `${Math.round(row.confidence * 100)}%`
                      : "-";
                  return (
                    <li key={`${causeId}-${index}`} className="rounded border border-gray-200 p-2 dark:border-gray-700">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{causeId}</p>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        Status: {status} • Confidence: {confidence}
                      </p>
                      {"reasoning" in row && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {toStringValue(row.reasoning)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <div className="space-y-6">
          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Chat history
            </h2>
            {parsedMessages.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">No chat messages found.</p>
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {parsedMessages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                        message.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{message.content || "(empty)"}</p>

                      {message.images.length > 0 && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {message.images.map((url, imgIndex) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${url}-${imgIndex}`}
                              src={url}
                              alt={`User image ${imgIndex + 1}`}
                              className="max-h-48 w-full rounded-md border border-black/10 object-contain bg-black/5"
                            />
                          ))}
                        </div>
                      )}

                      {message.guideImages.length > 0 && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {message.guideImages.map((url, imgIndex) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${url}-${imgIndex}`}
                              src={url}
                              alt={`Assistant image ${imgIndex + 1}`}
                              className="max-h-48 w-full rounded-md border border-black/10 object-contain bg-black/5"
                            />
                          ))}
                        </div>
                      )}

                      {message.resolution?.diagnosis && (
                        <div className="mt-3 space-y-2 border-t border-green-200 pt-2 text-xs dark:border-green-800">
                          <p className="font-semibold text-green-700 dark:text-green-300">
                            Diagnosis: {message.resolution.diagnosis}
                          </p>
                          {message.resolution.steps.length > 0 && (
                            <ol className="list-inside list-decimal space-y-1 text-current">
                              {message.resolution.steps.map((step, stepIndex) => (
                                <li key={`${step}-${stepIndex}`}>{step}</li>
                              ))}
                            </ol>
                          )}
                          {message.resolution.why && <p>Why: {message.resolution.why}</p>}
                        </div>
                      )}

                      {message.escalationReason && (
                        <div className="mt-3 border-t border-amber-200 pt-2 text-xs text-amber-800 dark:border-amber-700 dark:text-amber-300">
                          Connecting to support: {message.escalationReason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              Internal notes
            </h2>

            <form onSubmit={handleAddNote} className="mb-4 space-y-2">
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Add internal note..."
                rows={3}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
              <button
                type="submit"
                disabled={noteSaving}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {noteSaving ? "Adding..." : "Add note"}
              </button>
              {noteError && <p className="text-sm text-red-600 dark:text-red-400">{noteError}</p>}
            </form>

            {data.notes.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">No notes yet.</p>
            ) : (
              <div className="space-y-3">
                {data.notes.map((note) => {
                  const canDelete = data.currentUser?.id === note.authorId;
                  const deleting = deletingNoteId === note.id;
                  return (
                    <div
                      key={note.id}
                      className="rounded-md border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          {note.authorEmail ?? "Unknown user"} • {formatDate(note.createdAt)}
                        </span>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteNote(note.id)}
                            disabled={deleting}
                            className="font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                          >
                            {deleting ? "Deleting..." : "Delete"}
                          </button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
                        {note.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
