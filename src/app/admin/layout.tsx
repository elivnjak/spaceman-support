import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-6xl gap-6 px-4 py-3">
          <Link
            href="/admin"
            className="font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/labels"
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Labels
          </Link>
          <Link
            href="/admin/images"
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Reference images
          </Link>
          <Link
            href="/admin/docs"
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Documents
          </Link>
          <Link
            href="/admin/playbooks"
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Playbooks
          </Link>
          <Link
            href="/admin/test"
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Test console
          </Link>
          <Link
            href="/"
            className="ml-auto text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Back to app
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
