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
  evidence_progress?: {
    collected_required: number;
    required_total: number;
    ratio: number;
  };
  citations?: CitationItem[];
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

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [machineModel, setMachineModel] = useState("");
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
  const [requestDrafts, setRequestDrafts] = useState<Record<string, string>>({});
  const [answeredRequestIds, setAnsweredRequestIds] = useState<Set<string>>(new Set());
  const inputFieldRef = useRef<HTMLInputElement>(null);
  const [evidenceProgress, setEvidenceProgress] = useState<{
    collected_required: number;
    required_total: number;
    ratio: number;
  } | null>(null);
  const SNIPPET_LENGTH = 280;

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
    if (!loading) inputFieldRef.current?.focus();
  }, [loading]);

  const sendMessage = async (e: React.FormEvent, inputOverride?: string) => {
    e.preventDefault();
    const text = (inputOverride ?? input).trim();
    if (!text && files.length === 0) return;
    if (!sessionId && !machineModel.trim()) {
      setError("Machine model is required to start troubleshooting.");
      return;
    }
    setLoading(true);
    setStage("");
    setError("");
    setInput("");
    const userImages = [...files];
    setFiles([]);

    const form = new FormData();
    form.set("message", text || "(sent photos)");
    if (sessionId) form.set("sessionId", sessionId);
    if (machineModel.trim()) form.set("machineModel", machineModel.trim());
    userImages.forEach((f) => form.append("images", f));

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text || "Sent photo(s)", images: userImages.length ? [] : undefined },
    ]);

    try {
      const res = await fetch("/api/chat", { method: "POST", body: form });
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
        setEvidenceProgress(payload.evidence_progress ?? null);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: payload.message,
            requests: payload.requests?.length ? payload.requests : undefined,
            resolution: payload.resolution,
            escalation_reason: payload.escalation_reason,
            citations: payload.citations?.length ? payload.citations : undefined,
          },
        ]);
        setDebugState((s) => ({
          ...s,
          phase: payload!.phase,
          lastRequests: payload!.requests,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const sendQuickReply = async (text: string, requestId?: string) => {
    if (requestId) {
      setAnsweredRequestIds((prev) => new Set(prev).add(requestId));
    }
    await sendMessage({ preventDefault: () => {} } as React.FormEvent, text);
  };

  const lastAssistantIndex = messages.reduce(
    (acc, m, idx) => (m.role === "assistant" ? idx : acc),
    -1
  );

  return (
    <main className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back
          </Link>
          <h1 className="text-lg font-semibold">Diagnostic chat</h1>
          <div className="w-16" />
        </div>
        {sessionId && (
          <p className="mx-auto mt-1 max-w-2xl truncate text-xs text-gray-500 dark:text-gray-400">
            Session: {sessionId}
          </p>
        )}
        <div className="mx-auto mt-2 max-w-2xl">
          <input
            type="text"
            placeholder="Machine model (optional)"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={machineModel}
            onChange={(e) => setMachineModel(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Include model if known. Better model context improves diagnosis quality.
          </p>
          {evidenceProgress && evidenceProgress.required_total > 0 && (
            <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900">
              <div className="mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                <span>Evidence progress</span>
                <span>
                  {evidenceProgress.collected_required}/{evidenceProgress.required_total} required
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-2 bg-blue-600"
                  style={{ width: `${Math.max(0, Math.min(100, evidenceProgress.ratio * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden p-4">
        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.length === 0 && (
            <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
              Describe your issue and optionally attach photos. We’ll ask follow-up questions to narrow down the cause.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.role === "user"
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
                {m.role === "assistant" && m.requests && m.requests.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {m.requests.map((req) => {
                      const isAnswered = answeredRequestIds.has(req.id);
                      const isLatest = i === lastAssistantIndex && !loading;
                      const isInteractive = isLatest && !isAnswered;

                      if (!isInteractive) {
                        return (
                          <div key={req.id} className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="line-through">{req.prompt}</span>
                          </div>
                        );
                      }

                      return (
                        <div key={req.id}>
                          {req.type === "reading" && (
                            <div className="mt-1">
                              {req.expectedInput && (
                                <p className="mb-1.5 text-xs text-gray-500 dark:text-gray-400">
                                  {req.expectedInput.unit && `Unit: ${req.expectedInput.unit}`}
                                  {req.expectedInput.range &&
                                    ` · Range: ${req.expectedInput.range.min}–${req.expectedInput.range.max}`}
                                </p>
                              )}
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  className="w-32 rounded-full border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                                  placeholder={req.expectedInput?.unit ?? "value"}
                                  min={req.expectedInput?.range?.min}
                                  max={req.expectedInput?.range?.max}
                                  value={requestDrafts[req.id] ?? ""}
                                  onChange={(e) =>
                                    setRequestDrafts((prev) => ({
                                      ...prev,
                                      [req.id]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && requestDrafts[req.id]) {
                                      e.preventDefault();
                                      sendQuickReply(
                                        `${req.id}: ${requestDrafts[req.id]}${req.expectedInput?.unit ? ` ${req.expectedInput.unit}` : ""}`,
                                        req.id
                                      );
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={!requestDrafts[req.id]}
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-30"
                                  onClick={() =>
                                    sendQuickReply(
                                      requestDrafts[req.id]
                                        ? `${req.id}: ${requestDrafts[req.id]}${req.expectedInput?.unit ? ` ${req.expectedInput.unit}` : ""}`
                                        : req.prompt,
                                      req.id
                                    )
                                  }
                                >
                                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )}

                          {req.expectedInput?.options && req.expectedInput.options.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {req.expectedInput.options.map((opt) => (
                                <button
                                  key={`${req.id}-${opt}`}
                                  type="button"
                                  className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                                  onClick={() => sendQuickReply(`${req.id}: ${opt}`, req.id)}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}

                          {req.type === "question" && !req.expectedInput?.options && (
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                              Reply in the message box below.
                            </p>
                          )}

                          {req.type === "photo" && (
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="mt-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                            >
                              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                              </svg>
                              Upload photo
                            </button>
                          )}

                          {req.type === "action" && !(req.expectedInput?.options && req.expectedInput.options.length > 0) && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
                                onClick={() => sendQuickReply(`${req.id}: done`, req.id)}
                              >
                                Done
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:bg-gray-700"
                                onClick={() => sendQuickReply(`${req.id}: unable`, req.id)}
                              >
                                Can&apos;t do this
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {m.role === "assistant" && m.resolution && (
                  <div className="mt-3 space-y-2 border-t border-green-200 pt-2 dark:border-green-800">
                    <p className="font-medium text-green-800 dark:text-green-300">
                      Diagnosis: {m.resolution.diagnosis}
                    </p>
                    {(m.resolution.steps?.length ?? 0) > 0 && (
                      <ol className="list-inside list-decimal space-y-1 text-sm">
                        {(m.resolution.steps ?? []).map((s, k) => (
                          <li key={k}>{s.instruction}</li>
                        ))}
                      </ol>
                    )}
                    {m.resolution.why && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Why: {m.resolution.why}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Did this solve your issue?
                      </span>
                      <button
                        type="button"
                        className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
                        onClick={() => sendQuickReply("resolved")}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700"
                        onClick={() => sendQuickReply("not fixed")}
                      >
                        No
                      </button>
                    </div>
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
            ref={inputFieldRef}
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
