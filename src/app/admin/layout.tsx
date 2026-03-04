import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getSessionCookieName,
  hasAdminUiAccess,
  type AdminUiRole,
  validateSession,
} from "@/lib/auth";
import { AdminSidebarProvider } from "./AdminSidebarProvider";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-pathname") ?? "/admin";
  let role: AdminUiRole | null = null;
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    const session = sessionToken ? await validateSession(sessionToken) : null;
    role = session && hasAdminUiAccess(session.user.role) ? session.user.role : null;
  } catch {
    role = null;
  }

  if (!role) {
    if (pathname !== "/admin") {
      const next = encodeURIComponent(pathname);
      redirect(`/admin?unauthorized=1&next=${next}`);
    }
    return (
      <div className="min-h-screen bg-page">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page">
      <AdminSidebarProvider role={role}>
        {children}
      </AdminSidebarProvider>
    </div>
  );
}
