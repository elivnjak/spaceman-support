"use client";

import { useMemo, useRef, useState } from "react";

type CitationItem = {
  chunkId: string;
  content: string;
  documentId?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: CitationItem[];
};

type ApiResponse = {
  answer: string;
  citations?: CitationItem[];
  retrievedChunkCount?: number;
  error?: string;
};

const DOC_REF_REGEX =
  /\(document\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

type MessageSegment =
  | { type: "text"; value: string }
  | { type: "citation"; chunkId: string };

function getMessageSegments(content: string, citations?: CitationItem[]): MessageSegment[] {
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

export function AdminRagChatClient() {
  const [modelNumber, setModelNumber] = useState("");
  const [question, setQuestion] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCitation, setOpenCitation] = useState<CitationItem | null>(null);
  const [retrievedChunkCount, setRetrievedChunkCount] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = useMemo(
    () => (question.trim().length > 0 || files.length > 0) && !loading,
    [question, files.length, loading]
  );

  async function sendQuestion(e: React.FormEvent) {
    e.preventDefault();
    const trimmedQuestion = question.trim();
    const trimmedModel = modelNumber.trim();
    if ((!trimmedQuestion && files.length === 0) || loading) return;
    const userFiles = [...files];

    const historyForApi = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setLoading(true);
    setError(null);
    setQuestion("");
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    const userDisplay =
      trimmedQuestion || (userFiles.length > 0 ? "Please analyze the attached image(s)." : "Sent");
    setMessages((prev) => [...prev, { role: "user", content: userDisplay }]);

    try {
      const formData = new FormData();
      if (trimmedModel) formData.set("modelNumber", trimmedModel);
      if (trimmedQuestion) formData.set("question", trimmedQuestion);
      formData.set("messages", JSON.stringify(historyForApi));
      userFiles.forEach((file) => formData.append("images", file));

      const response = await fetch("/api/admin/rag-chat", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }
      setRetrievedChunkCount(
        typeof payload?.retrievedChunkCount === "number" ? payload.retrievedChunkCount : null
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: payload?.answer || "No answer was returned.",
          citations: payload?.citations?.length ? payload.citations : undefined,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send question.");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I could not generate an answer due to a request error.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function startNewTest() {
    setMessages([]);
    setQuestion("");
    setFiles([]);
    setError(null);
    setOpenCitation(null);
    setRetrievedChunkCount(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openCitationForChunk(msg: Message, chunkId: string) {
    const hit = msg.citations?.find((c) => c.chunkId.toLowerCase() === chunkId.toLowerCase());
    if (hit) setOpenCitation(hit);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-border bg-surface p-4 shadow-card">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Model number (optional)</label>
            <input
              type="text"
              value={modelNumber}
              onChange={(e) => setModelNumber(e.target.value)}
              placeholder="e.g. SM-6210-C"
              className="w-full rounded-lg border border-border bg-page px-3 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={startNewTest}
              className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted hover:bg-page"
            >
              Reset chat
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-card border border-border bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Ask direct questions. This chat bypasses diagnostic workflow and focuses on RAG answer quality.
          </p>
          {retrievedChunkCount !== null && (
            <span className="rounded-full bg-page px-2 py-1 text-xs text-muted">
              Retrieved chunks: {retrievedChunkCount}
            </span>
          )}
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto rounded-lg border border-border bg-page p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted">
              Optionally set a model number, then ask a question to begin.
            </p>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-white"
                      : "border border-border bg-surface text-ink"
                  }`}
                >
                  {msg.role === "assistant" && msg.citations?.length ? (
                    <p className="whitespace-pre-wrap">
                      {getMessageSegments(msg.content, msg.citations).map((seg, segIndex) =>
                        seg.type === "text" ? (
                          <span key={segIndex}>{seg.value}</span>
                        ) : (
                          <button
                            key={segIndex}
                            type="button"
                            onClick={() => openCitationForChunk(msg, seg.chunkId)}
                            className="mx-0.5 inline-flex rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-primary/20"
                          >
                            [doc]
                          </button>
                        )
                      )}
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {msg.role === "assistant" && msg.citations?.length ? (
                    <div className="mt-2 space-y-2 border-t border-border pt-2">
                      {msg.citations.map((citation) => (
                        <div key={citation.chunkId} className="rounded-md border border-border bg-page p-2">
                          <p className="line-clamp-3 text-xs text-muted">{citation.content}</p>
                          {citation.documentId ? (
                            <a
                              href={`/admin/docs/${citation.documentId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-block font-mono text-xs text-primary hover:underline"
                            >
                              {citation.chunkId}
                            </a>
                          ) : (
                            <p className="mt-1 font-mono text-xs text-muted">{citation.chunkId}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        {files.length > 0 && (
          <div className="mb-2 rounded-lg border border-border bg-page px-3 py-2 text-xs text-muted">
            {files.length} image{files.length === 1 ? "" : "s"} attached
            <button
              type="button"
              onClick={() => {
                setFiles([]);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="ml-2 text-primary hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        <form ref={formRef} onSubmit={sendQuestion} className="mt-3 flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              if (selected.length > 0) {
                setFiles((prev) => [...prev, ...selected]);
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] rounded-lg border border-border bg-page px-3 py-2.5 text-sm text-muted hover:bg-aqua/20"
            title="Attach images"
          >
            Attach
          </button>
          <textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={modelNumber.trim() ? "Ask a question about this model..." : "Ask a question about the docs..."}
            className="min-h-[44px] flex-1 resize-y rounded-lg border border-border bg-page px-3 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            disabled={!canSend}
            className="min-h-[44px] rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </form>
      </section>

      {openCitation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenCitation(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-surface p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-mono text-xs text-muted">{openCitation.chunkId}</p>
              <button
                type="button"
                onClick={() => setOpenCitation(null)}
                className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-page"
              >
                Close
              </button>
            </div>
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-page p-3 text-sm text-ink">
              {openCitation.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
