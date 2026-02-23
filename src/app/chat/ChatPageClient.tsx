"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type RequestItem = {
  type: "question" | "photo" | "action" | "reading";
  id: string;
  prompt: string;
  expectedInput?: {
    type: string;
    unit?: string;
    range?: { min: number; max: number };
    options?: string[];
    values?: string[];
    enum?: string[];
  };
};

type CitationItem = {
  chunkId: string;
  content: string;
  reason?: string;
  documentId?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  guideImages?: string[];
  requests?: RequestItem[];
  resolution?: {
    causeId: string;
    diagnosis: string;
    steps: { step_id: string; instruction: string; check?: string }[];
    why: string;
  };
  escalation_reason?: string;
  citations?: CitationItem[];
};

type MessagePayload = {
  sessionId: string;
  message: string;
  phase: string;
  requests: RequestItem[];
  resolution?: ChatMessage["resolution"];
  escalation_reason?: string;
  citations?: CitationItem[];
  guideImages?: string[];
  model?: string | null;
  serialNumber?: string | null;
  productType?: string | null;
  playbookId?: string | null;
  playbookTitle?: string | null;
  playbookLabelId?: string | null;
};

const DOC_REF_REGEX =
  /\(document\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

type MessageSegment =
  | { type: "text"; value: string }
  | { type: "citation"; chunkId: string };

function getMessageSegments(
  content: string,
  citations?: CitationItem[]
): MessageSegment[] {
  if (!citations?.length) return [{ type: "text", value: content }];
  const segments: MessageSegment[] = [];
  let lastEnd = 0;
  for (const m of content.matchAll(DOC_REF_REGEX)) {
    if (m.index !== undefined && m.index > lastEnd) {
      segments.push({ type: "text", value: content.slice(lastEnd, m.index) });
    }
    const chunkId = m[1] ?? "";
    if (chunkId) segments.push({ type: "citation", chunkId });
    lastEnd = (m.index ?? 0) + (m[0]?.length ?? 0);
  }
  if (lastEnd < content.length) {
    segments.push({ type: "text", value: content.slice(lastEnd) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

export type ChatPageClientProps = {
  chatApiKey?: string | null;
  /** When true, hide the "Back" link (e.g. when chat is on the front page). */
  isHomePage?: boolean;
};

const INITIAL_ASSISTANT_MESSAGE =
  "Hi! What issue are you experiencing with your machine? You can also attach a photo if that helps.";

type InitialPhase = "idle" | "typing" | "done";

/** Delay before showing the first message so it feels like it was just sent. */
const FIRST_MESSAGE_DELAY_MS = 1500;

export function ChatPageClient({ chatApiKey, isHomePage }: ChatPageClientProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatStarted, setChatStarted] = useState(false);
  const [initialPhase, setInitialPhase] = useState<InitialPhase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugState, setDebugState] = useState<Record<string, unknown>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const [openCitation, setOpenCitation] = useState<CitationItem | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [requestInputs, setRequestInputs] = useState<Record<string, string>>({});
  const requestFileInputRef = useRef<HTMLInputElement>(null);
  const [activePhotoRequestId, setActivePhotoRequestId] = useState<string | null>(null);
  const SNIPPET_LENGTH = 280;

  // After user clicks Start: show typing indicator, then show first message.
  useEffect(() => {
    if (initialPhase !== "typing") return;
    const t = setTimeout(() => {
      setMessages([{ role: "assistant", content: INITIAL_ASSISTANT_MESSAGE }]);
      setInitialPhase("done");
    }, FIRST_MESSAGE_DELAY_MS);
    return () => clearTimeout(t);
  }, [initialPhase]);

  const updateRequestInput = (id: string, value: string) => {
    setRequestInputs((prev) => ({ ...prev, [id]: value }));
  };

  const buildResponseFromInputs = (requests: RequestItem[]): string => {
    const parts: string[] = [];
    for (const req of requests) {
      const val = requestInputs[req.id]?.trim();
      if (!val) continue;
      parts.push(val);
    }
    return parts.length > 0 ? parts.join("\n") : input.trim();
  };

  const getRequestInputKind = (req: RequestItem): "number" | "photo" | "boolean" | "options" | "text" => {
    const expectedType = req.expectedInput?.type?.toLowerCase();
    const hasOptions =
      (req.expectedInput?.options?.length ?? 0) > 0 ||
      (req.expectedInput?.values?.length ?? 0) > 0 ||
      (req.expectedInput?.enum?.length ?? 0) > 0;
    if (req.type === "photo" || expectedType === "photo") return "photo";
    if (req.type === "reading" || expectedType === "number") return "number";
    if (expectedType === "boolean" || expectedType === "bool") return "boolean";
    if (expectedType === "enum" || hasOptions) return "options";
    return "text";
  };

  const getRequestOptions = (req: RequestItem): string[] => {
    if ((req.expectedInput?.options?.length ?? 0) > 0) return req.expectedInput?.options ?? [];
    if ((req.expectedInput?.values?.length ?? 0) > 0) return req.expectedInput?.values ?? [];
    if ((req.expectedInput?.enum?.length ?? 0) > 0) return req.expectedInput?.enum ?? [];
    return [];
  };

  const submitRequestAnswers = (requests: RequestItem[]) => {
    if (loading) return;
    const built = buildResponseFromInputs(requests);
    if (!built) return;
    setInput(built);
    setRequestInputs({});
    setTimeout(() => {
      const form = document.querySelector("main form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }, 50);
  };

  const submitSingleRequestAnswer = (req: RequestItem, value: string) => {
    if (loading) return;
    setRequestInputs((prev) => ({ ...prev, [req.id]: value }));
    setInput(value);
    setRequestInputs({});
    setTimeout(() => {
      const form = document.querySelector("main form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }, 50);
  };

  const toggleCitation = (key: string) => {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openCitationModal = (messageIndex: number, chunkId: string) => {
    const msg = messages[messageIndex];
    const cit = msg?.citations?.find(
      (c) => c.chunkId.toLowerCase() === chunkId.toLowerCase()
    );
    if (cit) setOpenCitation(cit);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!chatStarted) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatStarted, initialPhase]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setLightbox((prev) =>
          prev && prev.index < prev.images.length - 1
            ? { ...prev, index: prev.index + 1 }
            : prev
        );
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setLightbox((prev) =>
          prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text && files.length === 0) return;
    setLoading(true);
    setStage("");
    setError("");
    setInput("");
    const userImages = [...files];
    setFiles([]);
    setRequestInputs({});

    const form = new FormData();
    form.set("message", text || "(sent photos)");
    if (sessionId) form.set("sessionId", sessionId);
    userImages.forEach((f) => form.append("images", f));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text || "Sent photo(s)", images: userImages.length ? [] : undefined },
    ]);

    try {
      const headers: HeadersInit = {};
      if (chatApiKey) headers.Authorization = `Bearer ${chatApiKey}`;
      const res = await fetch("/api/chat", { method: "POST", headers, body: form });
      if (!res.body) throw new Error("No response");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: MessagePayload | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const chunk of parts) {
          const eventMatch = chunk.match(/event:\s*(\S+)/);
          const dataMatch = chunk.match(/data:\s*([\s\S]+)/);
          if (eventMatch && dataMatch) {
            const event = eventMatch[1].trim();
            try {
              const data = JSON.parse(dataMatch[1].trim());
              if (event === "stage") setStage(data.message ?? "");
              if (event === "message") payload = data as MessagePayload;
              if (event === "error") setError(data.error ?? "Error");
            } catch (_) { }
          }
        }
      }
      if (payload) {
        setSessionId(payload.sessionId);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: payload.message,
            requests: payload.requests?.length ? payload.requests : undefined,
            resolution: payload.resolution,
            escalation_reason: payload.escalation_reason,
            citations: payload.citations?.length ? payload.citations : undefined,
            guideImages: payload.guideImages?.length ? payload.guideImages : undefined,
          },
        ]);
        setDebugState((s) => ({
          ...s,
          phase: payload!.phase,
          lastRequests: payload!.requests,
          model: payload!.model ?? s.model,
          serialNumber: payload!.serialNumber ?? s.serialNumber,
          productType: payload!.productType ?? s.productType,
          playbookId: payload!.playbookId ?? s.playbookId,
          playbookTitle: payload!.playbookTitle ?? s.playbookTitle,
          playbookLabelId: payload!.playbookLabelId ?? s.playbookLabelId,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-2xl items-center justify-center">
          <h1 className="text-lg font-semibold">Kuhlberg Support</h1>
        </div>
        {sessionId && (
          <p className="mx-auto mt-1 max-w-2xl truncate text-xs text-gray-500 dark:text-gray-400">
            Session: {sessionId}
          </p>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden p-4">
        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {!chatStarted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <p className="text-center text-gray-600 dark:text-gray-400">
              Welcome to Kuhlberg support chat. Click Start to get started.
            </p>
            <button
              type="button"
              onClick={() => {
                setChatStarted(true);
                setInitialPhase("typing");
              }}
              className="rounded-xl bg-blue-600 px-8 py-3 text-lg font-medium text-white shadow-lg transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              Start
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto">
              {initialPhase === "typing" && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white px-4 py-3 shadow dark:bg-gray-800">
                    <div className="flex gap-1.5">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-500 [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-500 [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-500 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex max-w-[85%] flex-col ${m.role === "assistant" ? "gap-3" : ""}`}>
                    <div
                      className={`rounded-2xl px-4 py-2 ${m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100"
                        }`}
                    >
                      {m.role === "assistant" && m.citations && m.citations.length > 0 ? (
                        <p className="whitespace-pre-wrap">
                          {getMessageSegments(m.content, m.citations).map((seg, k) =>
                            seg.type === "text" ? (
                              <span key={k}>{seg.value}</span>
                            ) : (
                              <button
                                key={k}
                                type="button"
                                onClick={() => openCitationModal(i, seg.chunkId)}
                                className="mx-0.5 inline-flex align-baseline rounded border border-blue-400/60 bg-blue-500/20 px-1.5 py-0.5 font-mono text-xs text-blue-700 hover:bg-blue-500/30 dark:border-blue-400/50 dark:bg-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/40"
                                title="View referenced content"
                              >
                                [doc]
                              </button>
                            )
                          )}
                        </p>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                      {m.role === "assistant" && m.guideImages && m.guideImages.length > 0 && (() => {
                        const count = m.guideImages.length;
                        const gridClass =
                          count === 1
                            ? "grid grid-cols-1"
                            : "grid grid-cols-3 gap-1.5";
                        const imgClass =
                          count === 1
                            ? "max-h-48 w-full rounded-md border border-gray-200 object-contain bg-gray-100 dark:border-gray-600 dark:bg-gray-700"
                            : "h-28 w-full rounded-md border border-gray-200 object-cover bg-gray-100 dark:border-gray-600 dark:bg-gray-700";
                        return (
                          <div className={`mt-2 ${gridClass}`}>
                            {m.guideImages.map((src, idx) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={`${src}-${idx}`}
                                src={src}
                                alt={`Guide image ${idx + 1} of ${count}`}
                                className={`${imgClass} cursor-pointer transition-opacity hover:opacity-90`}
                                onClick={() => setLightbox({ images: m.guideImages!, index: idx })}
                              />
                            ))}
                          </div>
                        );
                      })()}
                      {m.role === "assistant" && Boolean(m.resolution?.diagnosis) && (
                        <div className="mt-3 space-y-2 border-t border-green-200 pt-2 dark:border-green-800">
                          <p className="font-medium text-green-800 dark:text-green-300">
                            Diagnosis: {m.resolution?.diagnosis}
                          </p>
                          {(m.resolution?.steps?.length ?? 0) > 0 && (
                            <ol className="list-inside list-decimal space-y-1 text-sm">
                              {(m.resolution?.steps ?? []).map((s, k) => (
                                <li key={k}>{s.instruction}</li>
                              ))}
                            </ol>
                          )}
                          {m.resolution?.why && (
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              Why: {m.resolution?.why}
                            </p>
                          )}
                        </div>
                      )}
                      {m.role === "assistant" && m.escalation_reason && (
                        <div className="mt-3 border-t border-amber-200 pt-2">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                            Connecting to support: {m.escalation_reason}
                          </p>
                        </div>
                      )}
                      {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-gray-200 pt-2 dark:border-gray-600">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Referenced content
                          </p>
                          {m.citations.map((cit, j) => {
                            const key = `msg-${i}-cit-${j}`;
                            const isLong = cit.content.length > SNIPPET_LENGTH;
                            const expanded = expandedCitations.has(key);
                            const snippet = isLong && !expanded
                              ? `${cit.content.slice(0, SNIPPET_LENGTH)}…`
                              : cit.content;
                            return (
                              <div
                                key={j}
                                id={`citation-msg-${i}-cit-${j}`}
                                className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm dark:border-gray-600 dark:bg-gray-700/50"
                              >
                                <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                                  {snippet}
                                </p>
                                {cit.reason && (
                                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {cit.reason}
                                  </p>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-2 dark:border-gray-600">
                                  {cit.documentId ? (
                                    <Link
                                      href={`/admin/docs/${cit.documentId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="truncate font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                                      title="View document"
                                    >
                                      {cit.chunkId}
                                    </Link>
                                  ) : (
                                    <p className="truncate font-mono text-xs text-gray-400 dark:text-gray-500" title={cit.chunkId}>
                                      {cit.chunkId}
                                    </p>
                                  )}
                                  {isLong && (
                                    <button
                                      type="button"
                                      onClick={() => toggleCitation(key)}
                                      className="ml-3 text-xs text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                      {expanded ? "Show less" : "Show more"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {m.role === "assistant" && m.requests && m.requests.length > 0 && (() => {
                      const isLatest = i === messages.length - 1 && !loading;
                      const visibleRequests = m.requests.slice(0, 1);
                      const primaryRequest = visibleRequests[0];
                      const shouldShowManualSubmit =
                        primaryRequest != null &&
                        (() => {
                          const kind = getRequestInputKind(primaryRequest);
                          return kind === "text" || kind === "number" || kind === "photo";
                        })();
                      const hasAllVisibleAnswers =
                        visibleRequests.length > 0 &&
                        visibleRequests.every((req) => Boolean(requestInputs[req.id]?.trim()));
                      return (
                        <div className="space-y-3 rounded-xl border-l-4 border-blue-500 bg-blue-50 p-4 shadow-sm dark:border-blue-400 dark:bg-blue-950/40">
                          {visibleRequests.map((req, j) => {
                            const inputKind = getRequestInputKind(req);
                            return (
                              <div key={j}>
                                <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                                  {req.prompt}
                                </p>
                                {isLatest && inputKind === "number" && (
                                  <div className="mt-3 flex items-center gap-2">
                                    <input
                                      type="number"
                                      placeholder={req.expectedInput?.range ? `${req.expectedInput.range.min}–${req.expectedInput.range.max}` : "Enter value"}
                                      min={req.expectedInput?.range?.min}
                                      max={req.expectedInput?.range?.max}
                                      step="any"
                                      className="w-32 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-blue-700 dark:bg-gray-800"
                                      value={requestInputs[req.id] ?? ""}
                                      onChange={(e) => updateRequestInput(req.id, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          submitRequestAnswers(visibleRequests);
                                        }
                                      }}
                                    />
                                    {req.expectedInput?.unit && (
                                      <span className="text-xs text-blue-600 dark:text-blue-400">{req.expectedInput.unit}</span>
                                    )}
                                  </div>
                                )}
                                {isLatest && inputKind === "options" && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {getRequestOptions(req).map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => submitSingleRequestAnswer(req, opt)}
                                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${requestInputs[req.id] === opt
                                          ? "border-blue-500 bg-blue-600 text-white"
                                          : "border-blue-200 bg-white text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-900/40"
                                          }`}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {isLatest && inputKind === "boolean" && (
                                  <div className="mt-3 flex gap-2">
                                    {["Yes", "No"].map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => submitSingleRequestAnswer(req, opt)}
                                        className={`rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors ${requestInputs[req.id] === opt
                                          ? opt === "Yes"
                                            ? "border-green-500 bg-green-500 text-white"
                                            : "border-red-500 bg-red-500 text-white"
                                          : "border-blue-200 bg-white text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-900/40"
                                          }`}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {isLatest && inputKind === "text" && (
                                  <input
                                    type="text"
                                    placeholder="Type your answer..."
                                    className="mt-3 w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-blue-700 dark:bg-gray-800"
                                    value={requestInputs[req.id] ?? ""}
                                    onChange={(e) => updateRequestInput(req.id, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        submitRequestAnswers(visibleRequests);
                                      }
                                    }}
                                  />
                                )}
                                {isLatest && inputKind === "photo" && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActivePhotoRequestId(req.id);
                                      requestFileInputRef.current?.click();
                                    }}
                                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm hover:bg-blue-100 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-blue-900/40"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg>
                                    {files.length > 0 ? `${files.length} photo(s) selected` : "Attach photo"}
                                  </button>
                                )}
                                {!isLatest && inputKind === "number" && req.expectedInput && (
                                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                                    {req.expectedInput.unit && `Unit: ${req.expectedInput.unit}`}
                                    {req.expectedInput.range &&
                                      ` Range: ${req.expectedInput.range.min}–${req.expectedInput.range.max}`}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          {isLatest && shouldShowManualSubmit && (
                            <button
                              type="button"
                              disabled={loading || !hasAllVisibleAnswers}
                              onClick={() => submitRequestAnswers(visibleRequests)}
                              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                            >
                              Submit answers
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-white px-4 py-2 shadow dark:bg-gray-800">
                    <p className="text-gray-500 dark:text-gray-400">
                      {stage || "Thinking…"}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />

            <form onSubmit={sendMessage} className="mt-4 flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <input
                type="file"
                ref={requestFileInputRef}
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const newFiles = Array.from(e.target.files ?? []);
                  setFiles((prev) => [...prev, ...newFiles]);
                  if (activePhotoRequestId) {
                    updateRequestInput(activePhotoRequestId, `${newFiles.length} photo(s) attached`);
                    setActivePhotoRequestId(null);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                Photo
              </button>
              {files.length > 0 && (
                <span className="flex items-center text-sm text-gray-500">
                  {files.length} file(s)
                </span>
              )}
              <input
                type="text"
                placeholder="Type your message..."
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-800"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <button
          type="button"
          onClick={() => setDebugOpen((o) => !o)}
          className="w-full px-4 py-2 text-left text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {debugOpen ? "Hide debug" : "Show debug"}
        </button>
        {debugOpen && (
          <pre className="max-h-40 overflow-auto border-t border-gray-200 p-4 text-xs dark:border-gray-700">
            {JSON.stringify({ sessionId, messageCount: messages.length, ...debugState }, null, 2)}
          </pre>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative flex max-h-[90vh] max-w-[90vw] items-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute -right-3 -top-3 z-10 rounded-full bg-white p-1.5 shadow-lg hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-700 dark:text-gray-200" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {lightbox.images.length > 1 && (
              <button
                type="button"
                disabled={lightbox.index === 0}
                onClick={() => setLightbox((prev) => prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev)}
                className="mr-3 shrink-0 rounded-full bg-white/90 p-2 shadow-lg transition-opacity hover:bg-white disabled:opacity-30 dark:bg-gray-700/90 dark:hover:bg-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-800 dark:text-gray-200" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}

            <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.images[lightbox.index]}
                alt={`Guide image ${lightbox.index + 1} of ${lightbox.images.length}`}
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
                onClick={() => setLightbox((prev) => prev && prev.index < prev.images.length - 1 ? { ...prev, index: prev.index + 1 } : prev)}
                className="ml-3 shrink-0 rounded-full bg-white/90 p-2 shadow-lg transition-opacity hover:bg-white disabled:opacity-30 dark:bg-gray-700/90 dark:hover:bg-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-800 dark:text-gray-200" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {openCitation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpenCitation(null)}
        >
          <div
            className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Referenced content
              </h3>
              <button
                type="button"
                onClick={() => setOpenCitation(null)}
                className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-300">
              {openCitation.content}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {openCitation.documentId ? (
                <Link
                  href={`/admin/docs/${openCitation.documentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                  title={`View document (chunk ${openCitation.chunkId})`}
                >
                  {openCitation.chunkId}
                </Link>
              ) : (
                <p className="truncate font-mono text-xs text-gray-400 dark:text-gray-500" title={openCitation.chunkId}>
                  {openCitation.chunkId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
