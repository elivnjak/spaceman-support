"use client";

import { useState, useRef } from "react";
import Link from "next/link";

export default function AnalysePage() {
  const [text, setText] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<{
    predictedLabel?: string;
    labelDisplayName?: string;
    confidence?: number;
    unknown?: boolean;
    sessionId?: string;
    topMatches?: { referenceImageId: string; labelId: string; similarity: number }[];
    answer?: {
      diagnosis: string;
      steps: { step_id: string; instruction: string; check?: string }[];
      why: string;
      retakeTips?: string[];
    };
    clarifyingQuestions?: string[];
    retakeTips?: string[];
  } | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [followUpFiles, setFollowUpFiles] = useState<File[]>([]);
  const followUpFileInputRef = useRef<HTMLInputElement>(null);

  const runAnalyseRequest = async (form: FormData) => {
    const res = await fetch("/api/analyse", { method: "POST", body: form });
    if (!res.body) throw new Error("No response");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const chunk of lines) {
        const eventMatch = chunk.match(/event:\s*(\w+)/);
        const dataMatch = chunk.match(/data:\s*(.+)/);
        if (eventMatch && dataMatch) {
          const event = eventMatch[1];
          try {
            const data = JSON.parse(dataMatch[1].trim());
            if (event === "stage") setStage((data as { message?: string }).message ?? "");
            if (event === "result") {
              setResult(data as typeof result);
              setFollowUpAnswers([]);
              setFollowUpFiles([]);
            }
            if (event === "error") setError((data as { error?: string }).error ?? "Error");
          } catch (_) {}
        }
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStage("");
    setResult(null);
    setError("");
    setFollowUpAnswers([]);
    setFollowUpFiles([]);
    const form = new FormData();
    form.set("text", text);
    if (machineModel.trim()) form.set("machineModel", machineModel.trim());
    files.forEach((f) => form.append("images", f));
    try {
      await runAnalyseRequest(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!result?.sessionId || !result.clarifyingQuestions?.length) return;
    setLoading(true);
    setStage("");
    setError("");
    const form = new FormData();
    form.set("text", "");
    form.set("sessionId", result.sessionId);
    form.set(
      "answers",
      JSON.stringify(
        result.clarifyingQuestions.map((q, i) => ({
          question: q,
          answer: followUpAnswers[i] ?? "",
        }))
      )
    );
    if (machineModel.trim()) form.set("machineModel", machineModel.trim());
    followUpFiles.forEach((f) => form.append("images", f));
    try {
      await runAnalyseRequest(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-6 inline-block text-blue-600 hover:underline">
          ← Back
        </Link>
        <h1 className="mb-6 text-2xl font-bold">Describe your issue</h1>
        <form onSubmit={handleSubmit} className="mb-8 space-y-4">
          <textarea
            className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            rows={3}
            placeholder="Describe the issue"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium">
              Machine model (optional)
            </label>
            <input
              type="text"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
              placeholder="e.g. Spaceman 500"
              value={machineModel}
              onChange={(e) => setMachineModel(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Upload 1–3 photos</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="mt-1 block"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? stage || "Analysing…" : "Analyse"}
          </button>
        </form>

        {error && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-lg font-medium">
              {result.labelDisplayName} (confidence:{" "}
              {result.confidence != null
                ? (result.confidence * 100).toFixed(0)
                : ""}
              %)
            </p>

            {result.unknown ? (
              <div>
                <p className="mb-2 text-gray-600 dark:text-gray-400">
                  We need a bit more info.
                </p>
                {result.retakeTips && result.retakeTips.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">Retake photo tips:</p>
                    <ul className="list-disc pl-6 text-sm">
                      {result.retakeTips.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.clarifyingQuestions && result.clarifyingQuestions.length > 0 && (
                  <>
                    <p className="mt-2 text-sm font-medium">Clarifying questions:</p>
                    <form onSubmit={handleSubmitFollowUp} className="mt-2 space-y-3">
                      {result.clarifyingQuestions.map((q, i) => (
                        <div key={i}>
                          <p className="mb-1 text-sm text-gray-600 dark:text-gray-400">{q}</p>
                          <input
                            type="text"
                            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                            placeholder="Your answer"
                            value={followUpAnswers[i] ?? ""}
                            onChange={(e) => {
                              const next = [...followUpAnswers];
                              next[i] = e.target.value;
                              setFollowUpAnswers(next);
                            }}
                          />
                        </div>
                      ))}
                      <div>
                        <label className="block text-sm font-medium">
                          Optional: add another photo
                        </label>
                        <input
                          ref={followUpFileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => setFollowUpFiles(Array.from(e.target.files ?? []))}
                          className="mt-1 block text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {loading ? stage || "Re-analysing…" : "Submit answers"}
                      </button>
                    </form>
                  </>
                )}
              </div>
            ) : (
              <>
                {result.answer?.diagnosis && (
                  <p><strong>Diagnosis:</strong> {result.answer.diagnosis}</p>
                )}
                {result.answer?.steps && result.answer.steps.length > 0 && (
                  <div>
                    <p className="font-medium">Steps to fix:</p>
                    <ul className="mt-2 list-inside list-disc space-y-1">
                      {result.answer.steps.map((s, i) => (
                        <li key={i}>{s.instruction}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.answer?.why && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <strong>Why:</strong> {result.answer.why}
                  </p>
                )}
                {result.clarifyingQuestions && result.clarifyingQuestions.length > 0 && (
                  <>
                    <p className="mt-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                      To narrow down the cause (optional):
                    </p>
                    <form onSubmit={handleSubmitFollowUp} className="mt-2 space-y-3">
                      {result.clarifyingQuestions.map((q, i) => (
                        <div key={i}>
                          <p className="mb-1 text-sm text-gray-600 dark:text-gray-400">{q}</p>
                          <input
                            type="text"
                            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                            placeholder="Your answer"
                            value={followUpAnswers[i] ?? ""}
                            onChange={(e) => {
                              const next = [...followUpAnswers];
                              next[i] = e.target.value;
                              setFollowUpAnswers(next);
                            }}
                          />
                        </div>
                      ))}
                      <div>
                        <label className="block text-sm font-medium">
                          Optional: add another photo
                        </label>
                        <input
                          ref={followUpFileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => setFollowUpFiles(Array.from(e.target.files ?? []))}
                          className="mt-1 block text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {loading ? stage || "Re-analysing…" : "Submit answers"}
                      </button>
                    </form>
                  </>
                )}
              </>
            )}

            {result.topMatches && result.topMatches.length > 0 && (
              <div>
                <p className="mb-2 font-medium">Similar reference images</p>
                <div className="flex gap-2">
                  {result.topMatches.slice(0, 3).map((m) => (
                    <div
                      key={m.referenceImageId}
                      className="h-24 w-24 overflow-hidden rounded border border-gray-200 dark:border-gray-600"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/reference-image/${m.referenceImageId}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
