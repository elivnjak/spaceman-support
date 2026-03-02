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
    <div className="min-h-screen bg-page">
      <AdminNav role={role} />
      <main id="main-content" className="lg:pl-64">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
