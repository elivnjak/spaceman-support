import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionCookieName, hasAdminUiAccess, validateSession } from "@/lib/auth";
import { AdminLoginForm } from "../AdminLoginForm";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function AdminLoginPage({ searchParams }: Props) {
  const params = await searchParams;

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
    const session = sessionToken ? await validateSession(sessionToken) : null;

    if (session && hasAdminUiAccess(session.user.role)) {
      redirect("/admin");
    }
  } catch {
    // Fall through to the login form.
  }

  return <AdminLoginForm next={params.next} />;
}