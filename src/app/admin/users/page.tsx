import { cookies } from "next/headers";
import { getSessionCookieName, validateSession } from "@/lib/auth";
import AdminUsersPageClient from "./AdminUsersPageClient";

export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
  const session = sessionToken ? await validateSession(sessionToken) : null;
  const currentUserId = session?.user?.role === "admin" ? session.user.id : null;

  return <AdminUsersPageClient currentUserId={currentUserId} />;
}
