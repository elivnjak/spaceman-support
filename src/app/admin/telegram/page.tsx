"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { LoadingScreen } from "@/components/ui/LoadingScreen";

type TelegramConfigPayload = {
  enabled: boolean;
  botToken: string;
  hasBotToken?: boolean;
  botTokenPreview?: string;
  chatId: string;
  chatIds: string[];
};

type FetchedChat = {
  id: string;
  type: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

function chatLabel(chat: FetchedChat): string {
  if (chat.title) return `${chat.title} (${chat.id})`;
  const name = [chat.firstName, chat.lastName].filter(Boolean).join(" ") || chat.username;
  return name ? `${name} (${chat.id})` : chat.id;
}

export default function AdminTelegramPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingChatId, setAddingChatId] = useState<string | null>(null);
  const [removingChatId, setRemovingChatId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingEmailFallback, setTestingEmailFallback] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [hasSavedBotToken, setHasSavedBotToken] = useState(false);
  const [botTokenPreview, setBotTokenPreview] = useState("");
  const [chatIds, setChatIds] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState<"success" | "error" | null>(null);
  const [saveDetail, setSaveDetail] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<"success" | "error" | null>(null);
  const [testDetail, setTestDetail] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchedChats, setFetchedChats] = useState<FetchedChat[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/admin/telegram-config");
    const data = (await res.json()) as TelegramConfigPayload;
    setEnabled(data.enabled);
    setBotToken(data.botTokenPreview ?? data.botToken ?? "");
    setHasSavedBotToken(Boolean(data.hasBotToken));
    setBotTokenPreview(data.botTokenPreview ?? "");
    setChatIds(data.chatIds ?? (data.chatId ? [data.chatId] : []));
  }

  function handleBotTokenFocus() {
    if (!hasSavedBotToken) return;
    if (botTokenPreview && botToken === botTokenPreview) {
      setBotToken("");
    }
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaveMessage(null);
    setSaveDetail(null);
    try {
      const res = await fetch("/api/admin/telegram-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          botToken,
          chatIds,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        welcomeSentCount?: number;
        addedChatIdsCount?: number;
      };
      if (!res.ok) {
        setSaveMessage("error");
        setSaveDetail("Failed to save Telegram config. Please try again.");
        return;
      }
      await reload();
      if ((data.addedChatIdsCount ?? 0) > 0) {
        if ((data.welcomeSentCount ?? 0) === (data.addedChatIdsCount ?? 0)) {
          setSaveMessage("success");
          setSaveDetail(
            `Saved. Welcome message sent to ${data.welcomeSentCount ?? 0} new recipient(s).`
          );
        } else if ((data.welcomeSentCount ?? 0) > 0) {
          setSaveMessage("success");
          setSaveDetail(
            `Saved. Welcome message sent to ${data.welcomeSentCount ?? 0} of ${data.addedChatIdsCount ?? 0} new recipient(s).`
          );
        } else {
          setSaveMessage("success");
          setSaveDetail(
            "Saved, but no welcome messages were delivered to new recipients. Use the test button to verify token/chat IDs."
          );
        }
      } else {
        setSaveMessage("success");
        setSaveDetail("Telegram config saved.");
      }
      setTimeout(() => {
        setSaveMessage(null);
        setSaveDetail(null);
      }, 4000);
    } finally {
      setSaving(false);
    }
  }

  async function sendTestNotification() {
    setTesting(true);
    setTestMessage(null);
    setTestDetail(null);
    try {
      const res = await fetch("/api/admin/telegram-config/test", {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        sentCount?: number;
        total?: number;
      };
      if (!res.ok) {
        setTestMessage("error");
        setTestDetail(data.error ?? "Failed to send test notification.");
        return;
      }
      setTestMessage("success");
      setTestDetail(
        `Sent test message to ${data.sentCount ?? 0} of ${data.total ?? 0} configured chat(s).`
      );
      setTimeout(() => {
        setTestMessage(null);
        setTestDetail(null);
      }, 5000);
    } finally {
      setTesting(false);
    }
  }

  async function sendTestEmailFallback() {
    setTestingEmailFallback(true);
    setTestMessage(null);
    setTestDetail(null);
    try {
      const res = await fetch("/api/admin/telegram-config/test-email-fallback", {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        sent?: boolean;
      };
      if (!res.ok) {
        setTestMessage("error");
        setTestDetail(data.error ?? "Failed to send fallback email test.");
        return;
      }
      setTestMessage("success");
      setTestDetail("Fallback email test sent successfully.");
      setTimeout(() => {
        setTestMessage(null);
        setTestDetail(null);
      }, 5000);
    } finally {
      setTestingEmailFallback(false);
    }
  }

  async function fetchChatIds() {
    setFetching(true);
    setFetchError(null);
    setFetchedChats([]);
    try {
      const res = await fetch("/api/admin/telegram-config/fetch-chat-ids");
      const data = (await res.json()) as { error?: string; chats?: FetchedChat[] };
      if (!res.ok) {
        setFetchError(data.error ?? "Failed to fetch chat IDs");
        return;
      }
      setFetchedChats(data.chats ?? []);
      if ((data.chats ?? []).length === 0) {
        setFetchError("No chats found. Message your bot with /start in Telegram, then try again.");
      }
    } finally {
      setFetching(false);
    }
  }

  async function addChatId(id: string) {
    if (!id || chatIds.includes(id)) return;
    const nextChatIds = [...chatIds, id];
    setAddingChatId(id);
    setSaveMessage(null);
    setSaveDetail(null);
    try {
      const res = await fetch("/api/admin/telegram-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          botToken,
          chatIds: nextChatIds,
        }),
      });
      const data = (await res.json()) as {
        welcomeSentCount?: number;
        addedChatIdsCount?: number;
      };
      if (!res.ok) {
        setSaveMessage("error");
        setSaveDetail("Failed to add chat ID. Please check your bot token and try again.");
        return;
      }
      setChatIds(nextChatIds);
      setSaveMessage("success");
      if ((data.welcomeSentCount ?? 0) > 0) {
        setSaveDetail("Chat ID added and welcome message sent.");
      } else if ((data.addedChatIdsCount ?? 0) > 0) {
        setSaveDetail("Chat ID added, but welcome message was not delivered.");
      } else {
        setSaveDetail("Chat ID added.");
      }
    } finally {
      setAddingChatId(null);
    }
  }

  async function removeChatId(id: string) {
    if (!id || !chatIds.includes(id)) return;
    const nextChatIds = chatIds.filter((c) => c !== id);
    setRemovingChatId(id);
    setSaveMessage(null);
    setSaveDetail(null);
    try {
      const res = await fetch("/api/admin/telegram-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          botToken,
          chatIds: nextChatIds,
        }),
      });
      if (!res.ok) {
        setSaveMessage("error");
        setSaveDetail("Failed to remove chat ID. Please try again.");
        return;
      }
      setChatIds(nextChatIds);
      setSaveMessage("success");
      setSaveDetail("Chat ID removed.");
    } finally {
      setRemovingChatId(null);
    }
  }

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-8">
      <PageHeader title="Telegram escalation notifications" />

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Status</h2>
        <p className="mb-3 text-sm text-muted">
          Enable or disable Telegram alerts when a chat session is escalated.
        </p>
        <div className="flex items-center gap-3">
          <Toggle enabled={enabled} onChange={setEnabled} />
          <span
            className={`font-medium ${enabled ? "text-emerald-700" : "text-muted"}`}
          >
            {enabled ? "Telegram alerts enabled" : "Telegram alerts disabled"}
          </span>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Bot token</h2>
        <p className="mb-3 text-sm text-muted">
          Create a bot with @BotFather and paste the token here.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Bot token</label>
          <Input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            onFocus={handleBotTokenFocus}
            placeholder={botTokenPreview || "123456789:AA..."}
          />
          {hasSavedBotToken && (
            <p className="mt-2 text-xs text-muted">
              Saved token on file in <code>.env</code>. The value is shown masked for security; start typing to replace it.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Get your Chat ID</h2>
        <p className="mb-3 text-sm text-muted">
          Save your bot token above, then open your bot in Telegram and send <strong>/start</strong>.
          Click the button below to discover chats that have messaged your bot, then add the ones that should receive escalation alerts.
        </p>
        <Button
          variant="secondary"
          onClick={fetchChatIds}
          disabled={fetching || (!botToken.trim() && !hasSavedBotToken)}
        >
          {fetching ? "Fetching..." : "Fetch Chat IDs"}
        </Button>
        {fetchError && (
          <p className="mt-2 rounded border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">
            {fetchError}
          </p>
        )}
        {fetchedChats.length > 0 && (
          <ul className="mt-3 space-y-2">
            {fetchedChats.map((chat) => (
              <li
                key={chat.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-page py-2 pl-3 pr-2"
              >
                <span className="text-sm">
                  <code className="rounded bg-surface px-1.5 py-0.5 text-ink">{chat.id}</code>
                  <span className="ml-2 text-muted">{chatLabel(chat)}</span>
                </span>
                <Button
                  size="sm"
                  onClick={() => addChatId(chat.id)}
                  disabled={
                    chatIds.includes(chat.id) ||
                    addingChatId === chat.id ||
                    removingChatId !== null ||
                    saving
                  }
                >
                  {chatIds.includes(chat.id)
                    ? "Added"
                    : addingChatId === chat.id
                      ? "Adding..."
                      : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Recipients (Chat IDs)</h2>
        <p className="mb-3 text-sm text-muted">
          Escalation alerts will be sent to every chat listed here (e.g. your phone and a colleague&apos;s). Add and Remove both save instantly.
        </p>
        {chatIds.length === 0 ? (
          <p className="text-sm text-muted">No recipients yet. Use &quot;Fetch Chat IDs&quot; above and add at least one.</p>
        ) : (
          <ul className="space-y-2">
            {chatIds.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-page py-2 pl-3 pr-2"
              >
                <code className="text-sm text-ink">{id}</code>
                <button
                  type="button"
                  onClick={() => removeChatId(id)}
                  disabled={removingChatId === id || addingChatId !== null || saving}
                  className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {removingChatId === id ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-ink">Debug</h2>
        <p className="mb-3 text-sm text-muted">
          Send a live test message to every configured chat ID to verify notifications are working.
        </p>
        <Button
          variant="secondary"
          onClick={sendTestNotification}
          disabled={testing || testingEmailFallback || saving}
        >
          {testing ? "Sending test..." : "Send test notification"}
        </Button>
        <Button
          variant="secondary"
          onClick={sendTestEmailFallback}
          disabled={testing || testingEmailFallback || saving}
          className="ml-2"
        >
          {testingEmailFallback ? "Sending email test..." : "Send fallback email test"}
        </Button>
        {testMessage === "success" && testDetail && (
          <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {testDetail}
          </p>
        )}
        {testMessage === "error" && testDetail && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
            {testDetail}
          </p>
        )}
      </Card>

      {saveMessage === "success" && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {saveDetail ?? "Telegram config saved."}
        </p>
      )}
      {saveMessage === "error" && (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {saveDetail ?? "Failed to save. Please try again."}
        </p>
      )}

      <Button
        onClick={save}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Telegram config"}
      </Button>
    </div>
  );
}
