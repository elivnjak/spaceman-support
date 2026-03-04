import { cookies } from "next/headers";
import { getSessionCookieName, hasAdminUiAccess, validateSession } from "@/lib/auth";
import { AdminLoginForm } from "./AdminLoginForm";
import { AdminDashboardClient } from "./AdminDashboardClient";
import { PageHeader } from "@/components/ui/PageHeader";

type Props = {
  searchParams: Promise<{ unauthorized?: string; forbidden?: string; next?: string }>;
};

export default async function AdminDashboardPage({ searchParams }: Props) {
  const params = await searchParams;
  let isAuthenticated = false;

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    const session = sessionToken ? await validateSession(sessionToken) : null;
    isAuthenticated = !!session && hasAdminUiAccess(session.user.role);
  } catch {
    isAuthenticated = false;
  }

  const showLogin = !isAuthenticated;
  const showForbidden = isAuthenticated && params.forbidden === "1";

  if (showLogin) {
    return <AdminLoginForm next={params.next} />;
  }

  return (
    <div>
      <PageHeader title="Dashboard" />
      {showForbidden && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-ink">
          This page is restricted to admin users.
        </div>
      )}
      <AdminDashboardClient />
    </div>
  );
}
