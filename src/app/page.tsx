import { cookies } from "next/headers";
import { ChatPageClient } from "@/app/chat/ChatPageClient";
import { MaintenancePage } from "@/app/chat/MaintenancePage";
import { db } from "@/lib/db";
import { maintenanceConfig, type MaintenanceConfig } from "@/lib/db/schema";
import { getSessionCookieName, validateSession } from "@/lib/auth";
import { getIntentManifest } from "@/lib/intent/loader";

export const dynamic = "force-dynamic";

const DEFAULT_TITLE = "Chat Unavailable";
const DEFAULT_DESCRIPTION =
  "Our support chat is currently undergoing maintenance.";
const DEFAULT_TECHNICAL_DIFFICULTIES_ESCALATION_MESSAGE =
  "We're experiencing technical difficulties right now. I'm connecting you with a technician to continue helping you.";

export default async function HomePage() {
  let isMaintenance = false;
  let config: MaintenanceConfig | undefined;
  let isAuthenticated = false;
  let technicalDifficultiesEscalationMessage =
    DEFAULT_TECHNICAL_DIFFICULTIES_ESCALATION_MESSAGE;
  const turnstileEnforceOverride =
    process.env.TURNSTILE_ENFORCE?.trim().toLowerCase() === "true";
  const turnstileEnabled = process.env.NODE_ENV === "production" || turnstileEnforceOverride;
  const turnstileSiteKey = turnstileEnabled
    ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ""
    : "";

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(getSessionCookieName())?.value?.trim();
    if (token) {
      const authSession = await validateSession(token);
      isAuthenticated = Boolean(authSession);
    }

    const [row] = await db.select().from(maintenanceConfig).limit(1);
    config = row;

    if (row?.enabled === true) {
      isMaintenance = !isAuthenticated;
    }
  } catch {
    // Database unreachable (e.g. ECONNREFUSED): fail open and show chat
    isMaintenance = false;
  }

  try {
    const manifest = await getIntentManifest();
    technicalDifficultiesEscalationMessage =
      manifest.communication.technicalDifficultiesEscalationMessage;
  } catch {
    // Keep default public fallback message if manifest cannot be loaded.
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
        <ChatPageClient
          isHomePage
          isAuthenticated={isAuthenticated}
          technicalDifficultiesMessage={technicalDifficultiesEscalationMessage}
          turnstileEnabled={turnstileEnabled}
          turnstileSiteKey={turnstileSiteKey}
        />
      </div>
    </main>
  );
}
