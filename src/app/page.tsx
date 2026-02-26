import { cookies } from "next/headers";
import { ChatPageClient } from "@/app/chat/ChatPageClient";
import { MaintenancePage } from "@/app/chat/MaintenancePage";
import { db } from "@/lib/db";
import { maintenanceConfig, type MaintenanceConfig } from "@/lib/db/schema";
import { getSessionCookieName, validateSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_TITLE = "Chat Unavailable";
const DEFAULT_DESCRIPTION =
  "Our support chat is currently undergoing maintenance.";

export default async function HomePage() {
  let isMaintenance = false;
  let config: MaintenanceConfig | undefined;

  try {
    const [row] = await db.select().from(maintenanceConfig).limit(1);
    config = row;

    if (row?.enabled === true) {
      const cookieStore = await cookies();
      const token = cookieStore.get(getSessionCookieName())?.value?.trim();
      if (!token) {
        isMaintenance = true;
      } else {
        const session = await validateSession(token);
        isMaintenance = !session;
      }
    }
  } catch {
    // Database unreachable (e.g. ECONNREFUSED): fail open and show chat
    isMaintenance = false;
  }

  if (isMaintenance && config) {
    return (
      <MaintenancePage
        iconUrl={config.iconPath ? "/api/maintenance-icon" : null}
        title={config.title ?? DEFAULT_TITLE}
        description={config.description ?? DEFAULT_DESCRIPTION}
        phone={config.phone ?? ""}
        email={config.email ?? ""}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col">
      <div className="min-h-0 flex-1">
        <ChatPageClient isHomePage />
      </div>
    </main>
  );
}
