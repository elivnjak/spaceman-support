import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { getSessionCookieName, isAdminRole, validateSession } from "@/lib/auth";

export default async function AdminBackupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session: Awaited<ReturnType<typeof validateSession>> = null;
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    session = sessionToken ? await validateSession(sessionToken) : null;
  } catch {
    redirect("/admin?unauthorized=1&next=/admin/backups");
  }

  if (!session) redirect("/admin?unauthorized=1&next=/admin/backups");
  if (!isAdminRole(session.user.role)) forbidden();

  return children;
}
