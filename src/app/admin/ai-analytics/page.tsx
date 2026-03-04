import { cookies } from "next/headers";
import { PageHeader } from "@/components/ui/PageHeader";
import { getSessionCookieName, hasAdminUiAccess, validateSession } from "@/lib/auth";
import { AdminLoginForm } from "../AdminLoginForm";
import { AiAnalyticsClient } from "./AiAnalyticsClient";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function AiAnalyticsPage({ searchParams }: Props) {
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

  if (!isAuthenticated) {
    return <AdminLoginForm next={params.next ?? "/admin/ai-analytics"} />;
  }

  return (
    <div>
      <PageHeader
        title="Insights"
        description="Analyze playbook performance, coverage gaps, and resolution behavior."
      />
      <AiAnalyticsClient />
    </div>
  );
}
