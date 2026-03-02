import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-red-600">
        403 Forbidden
      </p>
      <h1 className="mt-3 text-2xl font-bold text-ink">
        You do not have access to this page
      </h1>
      <p className="mt-2 text-sm text-muted">
        This area is restricted to admin users.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/admin"
          className="rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover"
        >
          Back to dashboard
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-ink hover:bg-aqua/30"
        >
          Back to app
        </Link>
      </div>
    </main>
  );
}
