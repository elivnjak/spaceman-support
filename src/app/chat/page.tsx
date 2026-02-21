import { ChatPageClient } from "./ChatPageClient";

export default function ChatPage() {
  return <ChatPageClient chatApiKey={process.env.CHAT_API_KEY ?? undefined} />;
}
