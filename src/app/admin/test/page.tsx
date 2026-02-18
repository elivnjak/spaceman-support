"use client";

import { useState, useRef } from "react";

export default function AdminTestPage() {
  const [text, setText] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStage("");
    setResult(null);
    setError("");
    const form = new FormData();
    form.set("text", text);
    if (machineModel.trim()) form.set("machineModel", machineModel.trim());
    files.forEach((f) => form.append("images", f));
    try {
      const res = await fetch("/api/analyse", { method: "POST", body: form });
      if (!res.body) throw new Error("No body");
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
              if (event === "result") setResult(data as Record<string, unknown>);
              if (event === "error") setError((data as { error?: string }).error ?? "Error");
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Test console</h1>
      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        <div>
          <label className="block text-sm font-medium">Describe the issue</label>
          <textarea
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. It's watery and melts fast"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Machine model (optional)</label>
          <input
            type="text"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            value={machineModel}
            onChange={(e) => setMachineModel(e.target.value)}
            placeholder="e.g. Spaceman 500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Images (1–3)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="mt-1 block"
          />
          {files.length > 0 && (
            <p className="mt-1 text-sm text-gray-500">
              {files.length} file(s) selected
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Analysing…" : "Analyse"}
        </button>
      </form>

      {stage && (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {stage}
        </p>
      )}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}
      {result && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="font-bold">Result</h2>
          <p>
            <strong>Predicted label:</strong>{" "}
            {(result as { predictedLabel?: string }).predictedLabel}{" "}
            ({(result as { labelDisplayName?: string }).labelDisplayName})
          </p>
          <p>
            <strong>Confidence:</strong>{" "}
            {(result as { confidence?: number }).confidence}
          </p>
          {(result as { unknown?: boolean }).unknown && (
            <div>
              <p className="font-medium">Clarifying questions:</p>
              <ul className="list-disc pl-6">
                {((result as { clarifyingQuestions?: string[] }).clarifyingQuestions ?? []).map(
                  (q, i) => (
                    <li key={i}>{q}</li>
                  )
                )}
              </ul>
              <p className="mt-2 font-medium">Retake tips:</p>
              <ul className="list-disc pl-6">
                {((result as { retakeTips?: string[] }).retakeTips ?? []).map(
                  (t, i) => (
                    <li key={i}>{t}</li>
                  )
                )}
              </ul>
            </div>
          )}
          {(result as { answer?: { diagnosis?: string; steps?: unknown[]; why?: string } }).answer && (
            <div>
              <p>
                <strong>Diagnosis:</strong>{" "}
                {(result as { answer?: { diagnosis?: string } }).answer?.diagnosis}
              </p>
              <p>
                <strong>Why:</strong>{" "}
                {(result as { answer?: { why?: string } }).answer?.why}
              </p>
              <p className="font-medium">Steps:</p>
              <ol className="list-decimal pl-6">
                {((result as { answer?: { steps?: { instruction?: string }[] } }).answer?.steps ?? []).map(
                  (s, i) => (
                    <li key={i}>{s.instruction}</li>
                  )
                )}
              </ol>
            </div>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer font-medium">
              Debug: top matches
            </summary>
            <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-900">
              {JSON.stringify((result as { topMatches?: unknown }).topMatches, null, 2)}
            </pre>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium">
              Debug: retrieved chunks
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-900">
              {JSON.stringify((result as { retrievedChunks?: unknown }).retrievedChunks, null, 2)}
            </pre>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium">
              Debug: full JSON
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-900">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
