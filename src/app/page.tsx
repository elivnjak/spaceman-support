import Link from "next/link";
import { ChatPageClient } from "@/app/chat/ChatPageClient";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex shrink-0 items-center justify-end gap-4 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
        <Link
          href="/analyse"
          className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          Single-shot analysis
        </Link>
        <Link
          href="/admin"
          className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          Admin
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <ChatPageClient chatApiKey={process.env.CHAT_API_KEY ?? undefined} isHomePage />
      </div>
    </main>
  );
}
