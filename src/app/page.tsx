import { ChatPageClient } from "@/app/chat/ChatPageClient";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="min-h-0 flex-1">
        <ChatPageClient chatApiKey={process.env.CHAT_API_KEY ?? undefined} isHomePage />
      </div>
    </main>
  );
}
