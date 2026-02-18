import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="text-3xl font-bold">RAG Support Agent</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Describe your issue and upload 1–3 photos to get a diagnosis and
          step-by-step fix.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/chat"
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Diagnostic chat (multi-turn)
          </Link>
          <Link
            href="/analyse"
            className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Single-shot analysis
          </Link>
          <Link
            href="/admin"
            className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Admin
          </Link>
        </div>
      </div>
    </main>
  );
}
