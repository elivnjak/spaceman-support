import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSessionCookieName, validateSession } from "@/lib/auth";
import {
  labels,
  referenceImages,
  documents,
  playbooks,
  actions,
  supportedModels,
  nameplateConfig,
  clearanceConfig,
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
      clearanceConfigList,
    ] = await Promise.all([
      db.select().from(labels),
      db.select().from(referenceImages),
      db.select().from(documents),
      db.select().from(playbooks),
      db.select().from(actions),
      db.select().from(supportedModels),
      db.select().from(nameplateConfig),
      db.select().from(clearanceConfig),
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
      clearanceConfigured: clearanceConfigList.length > 0,
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
      clearanceConfigured: false,
    };
  }
}

const DEFAULT_COUNTS = {
  labels: 0,
  images: 0,
  docs: 0,
  docsReady: 0,
  playbooks: 0,
  actions: 0,
  supportedModels: 0,
  nameplateConfigured: false,
  clearanceConfigured: false,
};

type Props = { searchParams: Promise<{ unauthorized?: string; next?: string }> };

export default async function AdminDashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  let isAuthenticated = false;
  let counts = DEFAULT_COUNTS;

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    const session = sessionToken ? await validateSession(sessionToken) : null;
    isAuthenticated = !!session && session.user.role === "admin";
    counts = isAuthenticated ? await getCounts() : DEFAULT_COUNTS;
  } catch {
    // Database unreachable (e.g. ECONNREFUSED): show login form only
    isAuthenticated = false;
    counts = DEFAULT_COUNTS;
  }

  const showLogin = !isAuthenticated || params.unauthorized === "1";

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold">Admin dashboard</h1>
      {showLogin && (
        <AdminLoginForm next={params.next} />
      )}
      {isAuthenticated && (
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Clearance Config
          </h2>
          <p className="mt-2 text-lg font-bold">
            {counts.clearanceConfigured ? "Configured" : "Not configured"}
          </p>
          <Link
            href="/admin/clearance"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Manage
          </Link>
        </div>
        </div>
      )}
    </div>
  );
}
