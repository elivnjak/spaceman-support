import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
        403 Forbidden
      </p>
      <h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">
        You do not have access to this page
      </h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        This area is restricted to admin users.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/admin"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Back to dashboard
        </Link>
        <Link
          href="/"
          className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          Back to app
        </Link>
      </div>
    </main>
  );
}
