import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  labels,
  referenceImages,
  documents,
  playbooks,
  actions,
  supportedModels,
  nameplateConfig,
} from "@/lib/db/schema";
import { AdminLoginForm } from "./AdminLoginForm";

async function getCounts() {
  try {
    const [
      labelsList,
      imagesList,
      docsList,
      playbooksList,
      actionsList,
      supportedModelsList,
      nameplateConfigList,
    ] = await Promise.all([
      db.select().from(labels),
      db.select().from(referenceImages),
      db.select().from(documents),
      db.select().from(playbooks),
      db.select().from(actions),
      db.select().from(supportedModels),
      db.select().from(nameplateConfig),
    ]);
    return {
      labels: labelsList.length,
      images: imagesList.length,
      docs: docsList.length,
      docsReady: docsList.filter((d) => d.status === "READY").length,
      playbooks: playbooksList.length,
      actions: actionsList.length,
      supportedModels: supportedModelsList.length,
      nameplateConfigured: nameplateConfigList.length > 0,
    };
  } catch {
    return {
      labels: 0,
      images: 0,
      docs: 0,
      docsReady: 0,
      playbooks: 0,
      actions: 0,
      supportedModels: 0,
      nameplateConfigured: false,
    };
  }
}

type Props = { searchParams: Promise<{ unauthorized?: string; next?: string }> };

export default async function AdminDashboardPage({ searchParams }: Props) {
  const counts = await getCounts();
  const params = await searchParams;
  const requiredToken = process.env.ADMIN_API_KEY?.trim();
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("admin_api_key")?.value?.trim() ?? "";
  const isAuthenticated = !!requiredToken && cookieToken === requiredToken;
  const showLogin =
    !!requiredToken && (!isAuthenticated || params.unauthorized === "1");

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold">Admin dashboard</h1>
      {showLogin && (
        <AdminLoginForm next={params.next} />
      )}
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Supported Models
          </h2>
          <p className="mt-2 text-3xl font-bold">{counts.supportedModels}</p>
          <Link
            href="/admin/models"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Nameplate Config
          </h2>
          <p className="mt-2 text-lg font-bold">
            {counts.nameplateConfigured ? "Configured" : "Not configured"}
          </p>
          <Link
            href="/admin/nameplate"
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
