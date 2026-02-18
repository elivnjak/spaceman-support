import Link from "next/link";
import { db } from "@/lib/db";
import { labels, referenceImages, documents, playbooks, actions } from "@/lib/db/schema";

async function getCounts() {
  try {
    const [labelsList, imagesList, docsList, playbooksList, actionsList] = await Promise.all([
      db.select().from(labels),
      db.select().from(referenceImages),
      db.select().from(documents),
      db.select().from(playbooks),
      db.select().from(actions),
    ]);
    return {
      labels: labelsList.length,
      images: imagesList.length,
      docs: docsList.length,
      docsReady: docsList.filter((d) => d.status === "READY").length,
      playbooks: playbooksList.length,
      actions: actionsList.length,
    };
  } catch {
    return { labels: 0, images: 0, docs: 0, docsReady: 0, playbooks: 0, actions: 0 };
  }
}

export default async function AdminDashboardPage() {
  const counts = await getCounts();

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold">Admin dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Reference images
          </h2>
          <p className="mt-2 text-3xl font-bold">{counts.images}</p>
          <Link
            href="/admin/images"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Documents
          </h2>
          <p className="mt-2 text-3xl font-bold">
            {counts.docs} ({counts.docsReady} ready)
          </p>
          <Link
            href="/admin/docs"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Labels
          </h2>
          <p className="mt-2 text-3xl font-bold">{counts.labels}</p>
          <Link
            href="/admin/labels"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Playbooks
          </h2>
          <p className="mt-2 text-3xl font-bold">{counts.playbooks}</p>
          <Link
            href="/admin/playbooks"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Action Catalog
          </h2>
          <p className="mt-2 text-3xl font-bold">{counts.actions}</p>
          <Link
            href="/admin/actions"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
      </div>
      <div className="mt-8">
        <Link
          href="/admin/test"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Test the assistant
        </Link>
      </div>
    </div>
  );
}
