import { cookies } from "next/headers";
import {
  getSessionCookieName,
  hasAdminUiAccess,
  type AdminUiRole,
  validateSession,
} from "@/lib/auth";
import { AdminNav } from "./AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let role: AdminUiRole | null = null;
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    const session = sessionToken ? await validateSession(sessionToken) : null;
    role = session && hasAdminUiAccess(session.user.role) ? session.user.role : null;
  } catch {
    role = null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AdminNav role={role} />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
