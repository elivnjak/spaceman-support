import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSessionCookieName, hasAdminUiAccess, validateSession } from "@/lib/auth";
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
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

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

type Props = { searchParams: Promise<{ unauthorized?: string; forbidden?: string; next?: string }> };

export default async function AdminDashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  let isAuthenticated = false;
  let counts = DEFAULT_COUNTS;

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    const session = sessionToken ? await validateSession(sessionToken) : null;
    isAuthenticated = !!session && hasAdminUiAccess(session.user.role);
    counts = isAuthenticated ? await getCounts() : DEFAULT_COUNTS;
  } catch {
    isAuthenticated = false;
    counts = DEFAULT_COUNTS;
  }

  const showLogin = !isAuthenticated || params.unauthorized === "1";
  const showForbidden = isAuthenticated && params.forbidden === "1";

  const statCards = [
    { label: "Reference images", value: counts.images, href: "/admin/images" },
    { label: "Documents", value: `${counts.docs} (${counts.docsReady} ready)`, href: "/admin/docs" },
    { label: "Labels", value: counts.labels, href: "/admin/labels" },
    { label: "Playbooks", value: counts.playbooks, href: "/admin/playbooks" },
    { label: "Action Catalog", value: counts.actions, href: "/admin/actions" },
    { label: "Supported Models", value: counts.supportedModels, href: "/admin/models" },
    { label: "Nameplate Config", value: counts.nameplateConfigured ? "Configured" : "Not configured", href: "/admin/nameplate" },
    { label: "Clearance Config", value: counts.clearanceConfigured ? "Configured" : "Not configured", href: "/admin/clearance" },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" />
      {showForbidden && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-ink">
          This page is restricted to admin users.
        </div>
      )}
      {showLogin && (
        <AdminLoginForm next={params.next} />
      )}
      {isAuthenticated && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <Card key={card.href} className="group transition-shadow hover:shadow-card-hover">
              <h2 className="text-sm font-medium text-muted">
                {card.label}
              </h2>
              <p className="mt-2 text-3xl font-bold text-ink">
                {card.value}
              </p>
              <Link
                href={card.href}
                className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
              >
                Manage
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
