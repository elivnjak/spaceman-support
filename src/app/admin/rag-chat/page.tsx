import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminRagChatClient } from "./AdminRagChatClient";
import {
  getSessionCookieName,
  hasAdminUiAccess,
  isAdminRole,
  validateSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminRagChatPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(getSessionCookieName())?.value?.trim() ?? "";
  const session = sessionToken ? await validateSession(sessionToken) : null;

  if (!session || !hasAdminUiAccess(session.user.role)) {
    redirect("/admin");
  }

  if (!isAdminRole(session.user.role)) {
    redirect("/admin?forbidden=1&next=%2Fadmin%2Frag-chat");
  }

  return (
    <div>
      <PageHeader
        title="RAG test chat"
        description="Set a model number and ask direct questions to evaluate retrieval quality, answer behavior, and citations."
      />
      <AdminRagChatClient />
    </div>
  );
}
