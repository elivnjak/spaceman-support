"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          appearance?: "always" | "execute" | "interaction-only";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const SKIP_SIGNAL = "__SKIP__";

type RequestItem = {
  type: "question" | "photo" | "action" | "reading";
  id: string;
  prompt: string;
  expectedInput?: {
    type: string;
    unit?: string;
    range?: { min: number; max: number };
    options?: string[];
    values?: string[];
    enum?: string[];
  };
};

type CitationItem = {
  chunkId: string;
  content: string;
  reason?: string;
  documentId?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  guideImages?: string[];
  requests?: RequestItem[];
  resolution?: {
    causeId: string;
    diagnosis: string;
    steps: { step_id: string; instruction: string; check?: string }[];
    why: string;
  };
  escalation_reason?: string;
  citations?: CitationItem[];
};

type MessagePayload = {
  sessionId: string;
  message: string;
  phase: string;
  requests: RequestItem[];
  resolution?: ChatMessage["resolution"];
  escalation_reason?: string;
  citations?: CitationItem[];
  guideImages?: string[];
};

function toDisplayString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return fallback;
  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" ? json : fallback;
  } catch {
    return fallback;
  }
}

const DOC_REF_REGEX =
  /\(document\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

type MessageSegment =
  | { type: "text"; value: string }
  | { type: "citation"; chunkId: string };

function getMessageSegments(
  content: string,
  citations?: CitationItem[]
): MessageSegment[] {
  if (!citations?.length) return [{ type: "text", value: content }];
  const segments: MessageSegment[] = [];
  let lastEnd = 0;
  for (const m of content.matchAll(DOC_REF_REGEX)) {
    if (m.index !== undefined && m.index > lastEnd) {
      segments.push({ type: "text", value: content.slice(lastEnd, m.index) });
    }
    const chunkId = m[1] ?? "";
    if (chunkId) segments.push({ type: "citation", chunkId });
    lastEnd = (m.index ?? 0) + (m[0]?.length ?? 0);
  }
  if (lastEnd < content.length) {
    segments.push({ type: "text", value: content.slice(lastEnd) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

export type ChatPageClientProps = {
  /** When true, hide the "Back" link (e.g. when chat is on the front page). */
  isHomePage?: boolean;
  /** True when user has an authenticated admin/editor session. */
  isAuthenticated?: boolean;
};

const INITIAL_ASSISTANT_MESSAGE =
  "Hi! What issue are you experiencing with your machine? You can also attach a photo if that helps.";
const PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE =
  "We're experiencing technical difficulties right now. I'm connecting you with a technician to continue helping you.";

type InitialPhase = "idle" | "typing" | "done";

/** Delay before showing the first message so it feels like it was just sent. */
const FIRST_MESSAGE_DELAY_MS = 1500;

/** Sessions older than this are not restored on reload. */
const SESSION_STALE_MS = 2 * 60 * 60 * 1000;

const CHAT_SESSION_STORAGE_KEY = "chatSessionId";
const CHAT_USER_NAME_KEY = "chatUserName";
const CHAT_USER_PHONE_KEY = "chatUserPhone";
const TURNSTILE_ENABLED =
  process.env.NODE_ENV === "production" ||
  process.env.NEXT_PUBLIC_TURNSTILE_ENFORCE?.trim().toLowerCase() === "true";
const TURNSTILE_SITE_KEY =
  TURNSTILE_ENABLED
    ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ""
    : "";

/** Australian phone: 8 digits (local), or 10 with 02/03/04/07/08, or 9 digits with +61 (2/3/4/7/8). */
function isValidAustralianPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 8) return true;
  if (digits.length === 10 && /^0[23478]/.test(digits)) return true;
  if (digits.length === 9 && /^[23478]/.test(digits)) return true;
  return false;
}

function getAustralianPhoneError(value: string): string | null {
  if (!value.trim()) return null;
  if (isValidAustralianPhone(value)) return null;
  return "Please enter a valid Australian phone number (e.g. 93459982, 04XX XXX XXX or 02 XXXX XXXX)";
}

/** Convert stored image path from backend to a URL the browser can load. */
function toSessionImageUrl(sessionId: string, storedPath: string): string {
  const normalized = storedPath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? "";
  return `/api/chat/${sessionId}/image/${encodeURIComponent(filename)}`;
}

/** Return a loadable image URL; pass through blob/http URLs, convert stored paths. */
function toImageUrl(sessionId: string | null, img: string): string {
  if (
    img.startsWith("blob:") ||
    img.startsWith("http://") ||
    img.startsWith("https://") ||
    (img.startsWith("/") && !img.startsWith("/api/chat/"))
  ) {
    return img;
  }
  return sessionId ? toSessionImageUrl(sessionId, img) : img;
}

export function ChatPageClient({ isHomePage, isAuthenticated = false }: ChatPageClientProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [chatStarted, setChatStarted] = useState(false);
  const [initialPhase, setInitialPhase] = useState<InitialPhase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [currentPhase, setCurrentPhase] = useState("collecting_issue");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());
  const [openCitation, setOpenCitation] = useState<CitationItem | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [requestInputs, setRequestInputs] = useState<Record<string, string>>({});
  const requestFileInputRef = useRef<HTMLInputElement>(null);
  const [activePhotoRequestId, setActivePhotoRequestId] = useState<string | null>(null);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [inputSource, setInputSource] = useState<"chat" | "structured" | "skip" | "note">("chat");
  const [connectionInterrupted, setConnectionInterrupted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileScriptLoaded, setTurnstileScriptLoaded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  /** When user clicks skip, store the message to show/send (e.g. "I don't have a photo" for photo requests). */
  const skipDisplayMessageRef = useRef<string>("I don't know");
  const sendInFlightRef = useRef(false);
  const pendingSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startScrollResetTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const startScrollViewportCleanupRef = useRef<(() => void) | null>(null);
  const lastSubmissionRef = useRef<{ key: string; atMs: number } | null>(null);
  const SNIPPET_LENGTH = 280;

  messagesRef.current = messages;

  const clearStartScrollResetTimers = useCallback(() => {
    for (const timer of startScrollResetTimersRef.current) {
      clearTimeout(timer);
    }
    startScrollResetTimersRef.current = [];
    if (startScrollViewportCleanupRef.current) {
      startScrollViewportCleanupRef.current();
      startScrollViewportCleanupRef.current = null;
    }
  }, []);

  const resetPageScrollToTop = useCallback(() => {
    const scrollingEl = document.scrollingElement;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (scrollingEl) {
      scrollingEl.scrollTop = 0;
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (window.visualViewport?.offsetTop) {
      window.scrollBy(0, -Math.ceil(window.visualViewport.offsetTop));
    }
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = 0;
    }
  }, []);

  const forceTopScrollAfterStart = useCallback(() => {
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement) {
      activeEl.blur();
    }

    clearStartScrollResetTimers();
    resetPageScrollToTop();
    requestAnimationFrame(resetPageScrollToTop);

    for (const delayMs of [40, 100, 180, 280, 420, 620, 900, 1200]) {
      const timer = setTimeout(resetPageScrollToTop, delayMs);
      startScrollResetTimersRef.current.push(timer);
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    const onViewportShift = () => {
      resetPageScrollToTop();
    };
    viewport.addEventListener("resize", onViewportShift);
    viewport.addEventListener("scroll", onViewportShift);
    startScrollViewportCleanupRef.current = () => {
      viewport.removeEventListener("resize", onViewportShift);
      viewport.removeEventListener("scroll", onViewportShift);
    };

    const removeViewportListenersTimer = setTimeout(() => {
      if (startScrollViewportCleanupRef.current) {
        startScrollViewportCleanupRef.current();
        startScrollViewportCleanupRef.current = null;
      }
    }, 1500);
    startScrollResetTimersRef.current.push(removeViewportListenersTimer);
  }, [clearStartScrollResetTimers, resetPageScrollToTop]);

  // Restore session from sessionStorage on mount (e.g. after page reload).
  useEffect(() => {
    const stored = sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
    if (!stored) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat/${stored}`);
        if (!res.ok || cancelled) {
          sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
          sessionStorage.removeItem(CHAT_USER_NAME_KEY);
          sessionStorage.removeItem(CHAT_USER_PHONE_KEY);
          return;
        }
        const session: {
          id: string;
          status: string;
          messages: ChatMessage[];
          phase: string;
          updatedAt: string | null;
          userName?: string | null;
          userPhone?: string | null;
        } = await res.json();

        if (cancelled) return;
        if (
          session.status === "resolved" ||
          session.status === "escalated" ||
          (session.updatedAt &&
            Date.now() - new Date(session.updatedAt).getTime() > SESSION_STALE_MS)
        ) {
          sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
          sessionStorage.removeItem(CHAT_USER_NAME_KEY);
          sessionStorage.removeItem(CHAT_USER_PHONE_KEY);
          return;
        }

        setSessionId(session.id);
        setUserName(session.userName ?? sessionStorage.getItem(CHAT_USER_NAME_KEY) ?? "");
        setUserPhone(session.userPhone ?? sessionStorage.getItem(CHAT_USER_PHONE_KEY) ?? "");
        setMessages(
          (session.messages ?? []).map((m) => ({
            ...m,
            images: m.images?.map((img) => toImageUrl(session.id, img)) ?? m.images,
          }))
        );
        setCurrentPhase(session.phase ?? "collecting_issue");
        setChatStarted(true);
        setInitialPhase("done");
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
          sessionStorage.removeItem(CHAT_USER_NAME_KEY);
          sessionStorage.removeItem(CHAT_USER_PHONE_KEY);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // After user clicks Start: show typing indicator, then show first message.
  useEffect(() => {
    if (initialPhase !== "typing") return;
    const t = setTimeout(() => {
      setMessages([{ role: "assistant", content: INITIAL_ASSISTANT_MESSAGE }]);
      setInitialPhase("done");
    }, FIRST_MESSAGE_DELAY_MS);
    return () => clearTimeout(t);
  }, [initialPhase]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverscrollBehaviorY = html.style.overscrollBehaviorY;
    const prevBodyOverscrollBehaviorY = body.style.overscrollBehaviorY;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.overscrollBehaviorY = prevHtmlOverscrollBehaviorY;
      body.style.overscrollBehaviorY = prevBodyOverscrollBehaviorY;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pendingSubmitTimerRef.current) {
        clearTimeout(pendingSubmitTimerRef.current);
        pendingSubmitTimerRef.current = null;
      }
      clearStartScrollResetTimers();
    };
  }, [clearStartScrollResetTimers]);

  const updateRequestInput = (id: string, value: string) => {
    setRequestInputs((prev) => ({ ...prev, [id]: value }));
  };

  const buildResponseFromInputs = (requests: RequestItem[]): string => {
    const parts: string[] = [];
    for (const req of requests) {
      const val = requestInputs[req.id]?.trim();
      if (!val) continue;
      parts.push(val);
    }
    return parts.length > 0 ? parts.join("\n") : input.trim();
  };

  const getRequestInputKind = (req: RequestItem): "number" | "photo" | "boolean" | "options" | "text" => {
    const expectedType = req.expectedInput?.type?.toLowerCase();
    const hasOptions =
      (req.expectedInput?.options?.length ?? 0) > 0 ||
      (req.expectedInput?.values?.length ?? 0) > 0 ||
      (req.expectedInput?.enum?.length ?? 0) > 0;
    if (req.type === "photo" || expectedType === "photo") return "photo";
    if (req.type === "reading" || expectedType === "number") return "number";
    if (expectedType === "boolean" || expectedType === "bool") return "boolean";
    if (expectedType === "enum" || hasOptions) return "options";
    return "text";
  };

  const getRequestOptions = (req: RequestItem): string[] => {
    if ((req.expectedInput?.options?.length ?? 0) > 0) return req.expectedInput?.options ?? [];
    if ((req.expectedInput?.values?.length ?? 0) > 0) return req.expectedInput?.values ?? [];
    if ((req.expectedInput?.enum?.length ?? 0) > 0) return req.expectedInput?.enum ?? [];
    return [];
  };

  const requestAlreadyHasUnknownOption = (req: RequestItem): boolean => {
    const options = getRequestOptions(req);
    if (options.length === 0) return false;
    return options.some((opt) =>
      /(don'?t know|do not know|not sure|unknown|no idea|unsure|can'?t say|cannot say|don'?t have|do not have)/i.test(
        opt
      )
    );
  };

  const submitRequestAnswers = (requests: RequestItem[]) => {
    if (loading || sendInFlightRef.current) return;
    const built = buildResponseFromInputs(requests);
    if (!built) return;
    setInputSource("structured");
    setInput(built);
    setRequestInputs({});
    if (pendingSubmitTimerRef.current) clearTimeout(pendingSubmitTimerRef.current);
    pendingSubmitTimerRef.current = setTimeout(() => {
      pendingSubmitTimerRef.current = null;
      const form = formRef.current;
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }, 50);
  };

  const submitSingleRequestAnswer = (req: RequestItem, value: string) => {
    if (loading || sendInFlightRef.current) return;
    setRequestInputs((prev) => ({ ...prev, [req.id]: value }));
    setInputSource(value === SKIP_SIGNAL ? "skip" : "structured");
    setInput(value);
    setRequestInputs({});
    if (value === SKIP_SIGNAL) {
      skipDisplayMessageRef.current =
        getRequestInputKind(req) === "photo" ? "I don't have a photo" : "I don't know";
    }
    if (pendingSubmitTimerRef.current) clearTimeout(pendingSubmitTimerRef.current);
    pendingSubmitTimerRef.current = setTimeout(() => {
      pendingSubmitTimerRef.current = null;
      const form = formRef.current;
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    }, 50);
  };

  const toggleCitation = (key: string) => {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openCitationModal = (messageIndex: number, chunkId: string) => {
    const msg = messages[messageIndex];
    const cit = msg?.citations?.find(
      (c) => c.chunkId.toLowerCase() === chunkId.toLowerCase()
    );
    if (cit) setOpenCitation(cit);
  };

  const startNewConversation = () => {
    clearStartScrollResetTimers();
    if (pendingSubmitTimerRef.current) {
      clearTimeout(pendingSubmitTimerRef.current);
      pendingSubmitTimerRef.current = null;
    }
    sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
    sessionStorage.removeItem(CHAT_USER_NAME_KEY);
    sessionStorage.removeItem(CHAT_USER_PHONE_KEY);
    setSessionId(null);
    setMessages([]);
    setChatStarted(false);
    setInitialPhase("idle");
    setCurrentPhase("collecting_issue");
    setError("");
    setConnectionInterrupted(false);
    setLoading(false);
    setStage("");
    setInput("");
    setFiles([]);
    setRequestInputs({});
    setExpandedCitations(new Set());
    setOpenCitation(null);
    setLightbox(null);
    setAddNoteOpen(false);
    setInputSource("chat");
    setActivePhotoRequestId(null);
  };

  const scrollToBottomIfNeeded = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (el.scrollHeight > el.clientHeight) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (messages.length <= 1) {
      window.scrollTo(0, 0);
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = 0;
      }
      return;
    }
    scrollToBottomIfNeeded();
  }, [messages]);

  useEffect(() => {
    if (!chatStarted) return;
    forceTopScrollAfterStart();
  }, [chatStarted, forceTopScrollAfterStart]);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setLightbox((prev) =>
          prev && prev.index < prev.images.length - 1
            ? { ...prev, index: prev.index + 1 }
            : prev
        );
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setLightbox((prev) =>
          prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
        );
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) touchStartRef.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      touchStartRef.current = null;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) {
        setLightbox((prev) =>
          prev && prev.index < prev.images.length - 1
            ? { ...prev, index: prev.index + 1 }
            : prev
        );
      } else {
        setLightbox((prev) =>
          prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
        );
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [lightbox]);

  // Revoke object URLs for user message images on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      messagesRef.current.forEach((m) => {
        if (m.role === "user" && m.images) {
          m.images.forEach((url) => {
            if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          });
        }
      });
    };
  }, []);

  useEffect(() => {
    if (sessionId || !TURNSTILE_SITE_KEY || !turnstileScriptLoaded) return;
    const container = turnstileContainerRef.current;
    if (!container || typeof window === "undefined" || !window.turnstile) return;

    setTurnstileToken(null);
    if (turnstileWidgetIdRef.current) {
      window.turnstile.remove(turnstileWidgetIdRef.current);
      turnstileWidgetIdRef.current = null;
    }

    turnstileWidgetIdRef.current = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      callback: (token) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
  }, [sessionId, turnstileScriptLoaded]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || sendInFlightRef.current) return;
    const text = input.trim();
    if (!text && files.length === 0) return;
    if (!sessionId && TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Please complete verification and try again.");
      return;
    }
    const latestAssistantWithRequests = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === "assistant" && (m.requests?.length ?? 0) > 0);
    const latestPendingRequest = latestAssistantWithRequests?.requests?.[0];
    const latestRequestIsPhoto =
      latestPendingRequest != null && getRequestInputKind(latestPendingRequest) === "photo";
    const textIsSkipLike =
      text === SKIP_SIGNAL ||
      /^i don'?t know\.?$/i.test(text) ||
      /^i don'?t have (a )?photo\.?$/i.test(text);
    const shouldTreatAsSkip =
      (inputSource === "skip" || textIsSkipLike) && latestPendingRequest != null;
    const resolvedSkipMessage = latestRequestIsPhoto ? "I don't have a photo" : "I don't know";
    const resolvedInputSource: "chat" | "structured" | "skip" | "note" = shouldTreatAsSkip
      ? "skip"
      : inputSource;
    const userImages = [...files];
    const messageToSend = shouldTreatAsSkip
      ? skipDisplayMessageRef.current || resolvedSkipMessage
      : text || "(sent photos)";
    const submissionKey = JSON.stringify({
      sessionId: sessionId ?? "__new__",
      message: messageToSend,
      inputSource: resolvedInputSource,
      imageCount: userImages.length,
      imageFingerprint: userImages.map((f) => `${f.name}:${f.size}`).join("|"),
    });
    const nowMs = Date.now();
    const lastSubmission = lastSubmissionRef.current;
    if (lastSubmission && lastSubmission.key === submissionKey && nowMs - lastSubmission.atMs < 2000) {
      return;
    }
    lastSubmissionRef.current = { key: submissionKey, atMs: nowMs };
    sendInFlightRef.current = true;

    setLoading(true);
    setStage("");
    setError("");
    setConnectionInterrupted(false);
    setInput("");
    setFiles([]);
    setRequestInputs({});

    const form = new FormData();
    form.set("message", messageToSend);
    form.set("inputSource", resolvedInputSource);
    if (sessionId) form.set("sessionId", sessionId);
    if (!sessionId && turnstileToken) {
      form.set("cf-turnstile-response", turnstileToken);
    }
    if (userName.trim()) form.set("userName", userName.trim());
    if (userPhone.trim()) form.set("userPhone", userPhone.trim());
    userImages.forEach((f) => form.append("images", f));

    const imageUrls = userImages.length
      ? userImages.map((f) => URL.createObjectURL(f))
      : undefined;
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: shouldTreatAsSkip
          ? (skipDisplayMessageRef.current || resolvedSkipMessage)
          : text || "Sent photo(s)",
        images: imageUrls,
      },
    ]);

    try {
      const res = await fetch("/api/chat", { method: "POST", body: form });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: unknown };
          msg = toDisplayString(data?.error, msg);
        } catch {
          // Non-JSON error body; keep fallback message
        }
        throw new Error(msg);
      }
      if (!res.body) throw new Error("No response");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: MessagePayload | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const chunk of parts) {
          const eventMatch = chunk.match(/event:\s*(\S+)/);
          const dataMatch = chunk.match(/data:\s*([\s\S]+)/);
          if (eventMatch && dataMatch) {
            const event = eventMatch[1].trim();
            try {
              const data = JSON.parse(dataMatch[1].trim());
              if (event === "stage") setStage(toDisplayString(data.message, ""));
              if (event === "message") payload = data as MessagePayload;
              if (event === "error") {
                if (isAuthenticated) {
                  setError(toDisplayString(data.error, "Error"));
                } else {
                  setError("");
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (
                      last?.role === "assistant" &&
                      last.content === PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE
                    ) {
                      return prev;
                    }
                    return [
                      ...prev,
                      {
                        role: "assistant",
                        content: PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE,
                        escalation_reason: "Technical difficulties while processing chat request.",
                      },
                    ];
                  });
                  setCurrentPhase("escalated");
                }
              }
            } catch (_) { }
          }
        }
      }
      if (payload) {
        setSessionId(payload.sessionId);
        sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, payload.sessionId);
        if (userName.trim()) sessionStorage.setItem(CHAT_USER_NAME_KEY, userName.trim());
        if (userPhone.trim()) sessionStorage.setItem(CHAT_USER_PHONE_KEY, userPhone.trim());
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: toDisplayString(payload.message, ""),
            requests: payload.requests?.length ? payload.requests : undefined,
            resolution: payload.resolution,
            escalation_reason: payload.escalation_reason,
            citations: payload.citations?.length ? payload.citations : undefined,
            guideImages: payload.guideImages?.length ? payload.guideImages : undefined,
          },
        ]);
        setCurrentPhase(payload.phase);
        setAddNoteOpen(false);
        if (
          payload.phase === "resolved_followup" ||
          payload.phase === "escalated"
        ) {
          sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
          sessionStorage.removeItem(CHAT_USER_NAME_KEY);
          sessionStorage.removeItem(CHAT_USER_PHONE_KEY);
        }
      } else if (sessionId) {
        setConnectionInterrupted(true);
      }
    } catch (err) {
      if (isAuthenticated) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError("");
        let recovered = false;
        if (sessionId) {
          try {
            const res = await fetch(`/api/chat/${sessionId}`);
            if (res.ok) {
              const session: {
                id: string;
                messages?: ChatMessage[];
                phase?: string;
                status?: string;
                userName?: string | null;
                userPhone?: string | null;
              } = await res.json();
              setUserName(session.userName ?? "");
              setUserPhone(session.userPhone ?? "");
              setMessages(
                (session.messages ?? []).map((m) => ({
                  ...m,
                  images: m.images?.map((img) => toImageUrl(session.id, img)) ?? m.images,
                }))
              );
              setCurrentPhase(session.phase ?? "collecting_issue");
              recovered = true;
            }
          } catch {
            // Recovery failed; fall through to generic assistant fallback
          }
        }

        if (!recovered) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (
              last?.role === "assistant" &&
              last.content === PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE
            ) {
              return prev;
            }
            return [
              ...prev,
              {
                role: "assistant",
                content: PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE,
                escalation_reason: "Technical difficulties while processing chat request.",
              },
            ];
          });
          setCurrentPhase("escalated");
        }
      }
    } finally {
      sendInFlightRef.current = false;
      setLoading(false);
      setInputSource("chat");
    }
  };

  const loadLatestReply = async () => {
    if (!sessionId) return;
    setError("");
    setConnectionInterrupted(false);
    try {
      const res = await fetch(`/api/chat/${sessionId}`);
      if (!res.ok) throw new Error("Could not load session");
      const session: {
        id: string;
        messages?: ChatMessage[];
        phase?: string;
        status?: string;
        updatedAt?: string | null;
        userName?: string | null;
        userPhone?: string | null;
      } = await res.json();
      setUserName(session.userName ?? "");
      setUserPhone(session.userPhone ?? "");
      setMessages(
        (session.messages ?? []).map((m) => ({
          ...m,
          images: m.images?.map((img) => toImageUrl(session.id, img)) ?? m.images,
        }))
      );
      setCurrentPhase(session.phase ?? "collecting_issue");
      setSessionId(session.id);
      sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, session.id);
      if (session.userName) sessionStorage.setItem(CHAT_USER_NAME_KEY, session.userName);
      if (session.userPhone) sessionStorage.setItem(CHAT_USER_PHONE_KEY, session.userPhone);
      if (
        session.status === "resolved" ||
        session.status === "escalated"
      ) {
        sessionStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
        sessionStorage.removeItem(CHAT_USER_NAME_KEY);
        sessionStorage.removeItem(CHAT_USER_PHONE_KEY);
      }
    } catch (err) {
      if (isAuthenticated) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError("");
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (
            last?.role === "assistant" &&
            last.content === PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE
          ) {
            return prev;
          }
          return [
            ...prev,
            {
              role: "assistant",
              content: PUBLIC_TECHNICAL_DIFFICULTIES_MESSAGE,
              escalation_reason: "Technical difficulties while processing chat request.",
            },
          ];
        });
        setCurrentPhase("escalated");
      }
    }
  };

  const isDiagnosticStructuredPhase =
    currentPhase === "nameplate_check" ||
    currentPhase === "product_type_check" ||
    currentPhase === "clearance_check" ||
    currentPhase === "gathering_info" ||
    currentPhase === "diagnosing";
  const latestAssistantWithRequests = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && (m.requests?.length ?? 0) > 0);
  const hasPendingStructuredRequest = Boolean(latestAssistantWithRequests) && !loading;
  const allowAddNote = currentPhase === "gathering_info" || currentPhase === "diagnosing";
  const hasUserSentMessage = messages.some((m) => m.role === "user");
  const showFullInput =
    currentPhase === "collecting_issue" &&
    !hasPendingStructuredRequest &&
    !hasUserSentMessage;
  const showTextOnlyInput =
    (currentPhase === "resolved_followup" || currentPhase === "escalated") &&
    !hasPendingStructuredRequest;

  return (
    <main className="flex h-dvh flex-col bg-page">
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={() => setTurnstileScriptLoaded(true)}
        />
      )}
      <header className="sticky top-0 z-10 px-4 py-3" style={{ backgroundColor: '#0B111E' }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-white">Kuhlberg Support</h1>
            {sessionId && (
              <p className="mt-1 hidden truncate text-xs text-muted">
                Session: {sessionId}
              </p>
            )}
          </div>
          {chatStarted && (
            <button
              type="button"
              onClick={startNewConversation}
              className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              style={{ backgroundColor: '#0F73B9' }}
            >
              New conversation
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden p-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {connectionInterrupted && sessionId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-accent/10 p-3 text-sm text-ink dark:border-amber-700 dark:bg-accent/20">
            <span>The connection was interrupted before the reply could be shown.</span>
            <button
              type="button"
              onClick={loadLatestReply}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 font-medium text-ink hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            >
              Load latest reply
            </button>
          </div>
        )}

        {!chatStarted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <img
              src="/kuhlberg-logo.webp"
              alt="Kühlberg"
              className="h-12 w-auto"
            />
            <p className="text-center text-muted">
              Welcome to Kuhlberg support chat. Please enter your details to get started.
            </p>
            <form
              className="flex w-full max-w-sm flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const err = getAustralianPhoneError(userPhone);
                setPhoneError(err);
                if (err) return;
                if (!userName.trim() || !userPhone.trim()) return;
                forceTopScrollAfterStart();
                setChatStarted(true);
                setInitialPhase("typing");
              }}
            >
              <div>
                <label htmlFor="prechat-name" className="mb-1 block text-sm font-medium text-ink">
                  Name
                </label>
                <input
                  id="prechat-name"
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label htmlFor="prechat-phone" className="mb-1 block text-sm font-medium text-ink">
                  Phone number
                </label>
                <input
                  id="prechat-phone"
                  type="tel"
                  required
                  value={userPhone}
                  onChange={(e) => {
                    setUserPhone(e.target.value);
                    setPhoneError(getAustralianPhoneError(e.target.value));
                  }}
                  onBlur={() => setPhoneError(getAustralianPhoneError(userPhone))}
                  placeholder="Your phone number"
                  aria-invalid={!!phoneError}
                  aria-describedby={phoneError ? "prechat-phone-error" : undefined}
                  className={`w-full rounded-lg border bg-surface px-3 py-2.5 text-ink placeholder:text-muted focus:outline-none focus:ring-2 ${phoneError
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                      : "border-border focus:border-primary focus:ring-primary/20"
                    }`}
                />
                {phoneError && (
                  <p id="prechat-phone-error" className="mt-1 text-sm text-red-600" role="alert">
                    {phoneError}
                  </p>
                )}
              </div>
              {TURNSTILE_SITE_KEY && (
                <div
                  ref={turnstileContainerRef}
                  className="overflow-hidden"
                />
              )}
              <button
                type="submit"
                disabled={!userName.trim() || !userPhone.trim() || !!getAustralianPhoneError(userPhone)}
                className="rounded-xl bg-primary px-8 py-3 text-lg font-medium text-white shadow-lg transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start
              </button>
            </form>
          </div>
        ) : (
          <>
            <div ref={messagesContainerRef} className="flex-1 space-y-4 overflow-y-auto">
              {initialPhase === "typing" && (
                <div className="flex justify-start">
                  <div className="rounded-[1.25rem] bg-aqua px-4 py-3 shadow-card">
                    <div className="flex gap-2">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex max-w-[85%] flex-col ${m.role === "assistant" ? "gap-3" : ""}`}>
                    <div
                      className={`rounded-2xl px-4 py-2.5 ${m.role === "user"
                        ? "bg-primary text-white"
                        : "bg-surface text-ink shadow-card border border-border"
                        }`}
                    >
                      {m.role === "assistant" && m.citations && m.citations.length > 0 ? (
                        <p className="whitespace-pre-wrap">
                          {getMessageSegments(m.content, m.citations).map((seg, k) =>
                            seg.type === "text" ? (
                              <span key={k}>{seg.value}</span>
                            ) : (
                              <button
                                key={k}
                                type="button"
                                onClick={() => openCitationModal(i, seg.chunkId)}
                                className="mx-0.5 inline-flex align-baseline rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-primary/20"
                                title="View referenced content"
                              >
                                [doc]
                              </button>
                            )
                          )}
                        </p>
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                      {m.role === "assistant" && m.guideImages && m.guideImages.length > 0 && (() => {
                        const count = m.guideImages.length;
                        const gridClass =
                          count === 1
                            ? "grid grid-cols-1"
                            : "grid grid-cols-3 gap-1.5";
                        const imgClass =
                          count === 1
                            ? "max-h-48 w-full rounded-lg border border-border object-contain bg-page"
                            : "h-28 w-full rounded-lg border border-border object-cover bg-page";
                        return (
                          <div className={`mt-2 ${gridClass}`}>
                            {m.guideImages.map((src, idx) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={`${src}-${idx}`}
                                src={src}
                                alt={`Guide image ${idx + 1} of ${count}`}
                                className={`${imgClass} cursor-pointer transition-opacity hover:opacity-90`}
                                onClick={() => setLightbox({ images: m.guideImages!, index: idx })}
                              />
                            ))}
                          </div>
                        );
                      })()}
                      {m.role === "user" && m.images && m.images.length > 0 && (() => {
                        const count = m.images!.length;
                        const urls = m.images!.map((src) => toImageUrl(sessionId, src));
                        const gridClass =
                          count === 1
                            ? "grid grid-cols-1"
                            : "grid grid-cols-3 gap-1.5";
                        return (
                          <div className={`mt-2 ${gridClass}`}>
                            {urls.map((src, idx) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={`${src}-${idx}`}
                                src={src}
                                alt={`Photo ${idx + 1} of ${count}`}
                                className="max-h-24 w-full cursor-pointer rounded-md border border-white/30 object-cover transition-opacity hover:opacity-90"
                                onClick={() => setLightbox({ images: urls, index: idx })}
                              />
                            ))}
                          </div>
                        );
                      })()}
                      {m.role === "assistant" && Boolean(m.resolution?.diagnosis) && (
                        <div className="mt-3 space-y-2 rounded-lg border border-accent/30 bg-[#FFF8E1] p-3 dark:bg-[#3D2E00]">
                          <p className="font-medium text-amber-800 dark:text-amber-200">
                            Diagnosis: {m.resolution?.diagnosis}
                          </p>
                          {(m.resolution?.steps?.length ?? 0) > 0 && (
                            <ol className="list-inside list-decimal space-y-1 text-sm">
                              {(m.resolution?.steps ?? []).map((s, k) => (
                                <li key={k}>{s.instruction}</li>
                              ))}
                            </ol>
                          )}
                          {m.resolution?.why && (
                            <p className="text-xs text-amber-700/70 dark:text-amber-300/70">
                              Why: {m.resolution?.why}
                            </p>
                          )}
                        </div>
                      )}
                      {m.role === "assistant" && m.escalation_reason && (
                        <div className="mt-3 border-t border-accent/30 pt-2">
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                            Connecting to support: {m.escalation_reason}
                          </p>
                        </div>
                      )}
                      {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-border pt-2">
                          <p className="text-xs font-medium text-muted">
                            Referenced content
                          </p>
                          {m.citations.map((cit, j) => {
                            const key = `msg-${i}-cit-${j}`;
                            const isLong = cit.content.length > SNIPPET_LENGTH;
                            const expanded = expandedCitations.has(key);
                            const snippet = isLong && !expanded
                              ? `${cit.content.slice(0, SNIPPET_LENGTH)}…`
                              : cit.content;
                            return (
                              <div
                                key={j}
                                id={`citation-msg-${i}-cit-${j}`}
                                className="rounded-lg border border-border bg-page p-2 text-sm"
                              >
                                <p className="whitespace-pre-wrap text-ink/80">
                                  {snippet}
                                </p>
                                {cit.reason && (
                                  <p className="mt-1 text-xs text-muted">
                                    {cit.reason}
                                  </p>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2">
                                  {cit.documentId ? (
                                    <Link
                                      href={`/admin/docs/${cit.documentId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="truncate font-mono text-xs text-primary hover:underline"
                                      title="View document"
                                    >
                                      {cit.chunkId}
                                    </Link>
                                  ) : (
                                    <p className="truncate font-mono text-xs text-muted" title={cit.chunkId}>
                                      {cit.chunkId}
                                    </p>
                                  )}
                                  {isLong && (
                                    <button
                                      type="button"
                                      onClick={() => toggleCitation(key)}
                                      className="ml-3 text-xs text-primary hover:underline"
                                    >
                                      {expanded ? "Show less" : "Show more"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {m.role === "assistant" && m.requests && m.requests.length > 0 && (() => {
                      const isLatest = i === messages.length - 1 && !loading;
                      const visibleRequests = m.requests.slice(0, 1);
                      const primaryRequest = visibleRequests[0];
                      const shouldShowManualSubmit =
                        primaryRequest != null &&
                        (() => {
                          const kind = getRequestInputKind(primaryRequest);
                          return kind === "text" || kind === "number" || kind === "photo";
                        })();
                      const manualSubmitLabel =
                        primaryRequest && getRequestInputKind(primaryRequest) === "photo"
                          ? "Send photo"
                          : "Submit answers";
                      const hasAllVisibleAnswers =
                        visibleRequests.length > 0 &&
                        visibleRequests.every((req) => Boolean(requestInputs[req.id]?.trim()));
                      return (
                        <div className="space-y-3 rounded-xl border border-primary/25 bg-[#E8F4FC] p-4 shadow-card dark:bg-[#0F2A3D]">
                          {visibleRequests.map((req, j) => {
                            const inputKind = getRequestInputKind(req);
                            return (
                              <div key={j}>
                                <p className="text-sm font-semibold text-ink">
                                  {req.prompt}
                                </p>
                                {isLatest && inputKind === "number" && (
                                  <div className="mt-3 flex items-center gap-2">
                                    <input
                                      type="number"
                                      placeholder={req.expectedInput?.range ? `${req.expectedInput.range.min}–${req.expectedInput.range.max}` : "Enter value"}
                                      min={req.expectedInput?.range?.min}
                                      max={req.expectedInput?.range?.max}
                                      step="any"
                                      className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                      value={requestInputs[req.id] ?? ""}
                                      onChange={(e) => updateRequestInput(req.id, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          submitRequestAnswers(visibleRequests);
                                        }
                                      }}
                                    />
                                    {req.expectedInput?.unit && (
                                      <span className="text-xs text-muted">{req.expectedInput.unit}</span>
                                    )}
                                  </div>
                                )}
                                {isLatest && inputKind === "options" && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {getRequestOptions(req).map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => submitSingleRequestAnswer(req, opt)}
                                        className={`min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors ${requestInputs[req.id] === opt
                                          ? "chat-option-pill-blue-selected"
                                          : "chat-option-pill-blue"
                                          }`}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                    {!requestAlreadyHasUnknownOption(req) && (
                                      <button
                                        type="button"
                                        onClick={() => submitSingleRequestAnswer(req, SKIP_SIGNAL)}
                                        className="min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors chat-option-pill-blue"
                                      >
                                        I don&apos;t know
                                      </button>
                                    )}
                                  </div>
                                )}
                                {isLatest && inputKind === "boolean" && (
                                  <div className="mt-3 flex gap-2">
                                    {["Yes", "No"].map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => submitSingleRequestAnswer(req, opt)}
                                        className={`min-h-[44px] rounded-full px-5 py-2 text-sm font-medium transition-colors ${requestInputs[req.id] === opt
                                          ? "chat-option-pill-blue-selected"
                                          : "chat-option-pill-blue"
                                          }`}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {isLatest && inputKind === "text" && (
                                  <textarea
                                    rows={1}
                                    placeholder="Type your answer..."
                                    className="mt-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm shadow-card transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    value={requestInputs[req.id] ?? ""}
                                    onChange={(e) => updateRequestInput(req.id, e.target.value)}
                                    onFocus={(e) => { e.currentTarget.rows = 3; }}
                                    onBlur={(e) => { if (!e.currentTarget.value.trim()) e.currentTarget.rows = 1; }}
                                    onInput={(e) => {
                                      const ta = e.currentTarget;
                                      ta.style.height = "auto";
                                      ta.style.height = `${ta.scrollHeight}px`;
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        submitRequestAnswers(visibleRequests);
                                      }
                                    }}
                                  />
                                )}
                                {isLatest && (
                                  <div className="mt-3 flex items-center gap-3">
                                    {inputKind === "photo" && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActivePhotoRequestId(req.id);
                                          requestFileInputRef.current?.click();
                                        }}
                                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-primary shadow-card hover:bg-aqua/30"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg>
                                        {files.length > 0 ? `${files.length} photo(s) selected` : "Attach photo"}
                                      </button>
                                    )}
                                    {inputKind !== "options" &&
                                      !(inputKind !== "photo" && requestAlreadyHasUnknownOption(req)) && (
                                        <button
                                          type="button"
                                          onClick={() => submitSingleRequestAnswer(req, SKIP_SIGNAL)}
                                          className="text-sm font-medium text-[#1174B9] hover:text-[#0E5F99]"
                                        >
                                          {inputKind === "photo" ? "I don't have a photo" : "I don't know"}
                                        </button>
                                      )}
                                  </div>
                                )}
                                {!isLatest && inputKind === "number" && req.expectedInput && (
                                  <p className="mt-1 text-xs text-muted">
                                    {req.expectedInput.unit && `Unit: ${req.expectedInput.unit}`}
                                    {req.expectedInput.range &&
                                      ` Range: ${req.expectedInput.range.min}–${req.expectedInput.range.max}`}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                          {isLatest && shouldShowManualSubmit && (
                            <button
                              type="button"
                              disabled={loading || !hasAllVisibleAnswers}
                              onClick={() => submitRequestAnswers(visibleRequests)}
                              className="w-full min-h-[44px] rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-card transition-colors hover:bg-primary-hover disabled:opacity-50"
                            >
                              {manualSubmitLabel}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
              {showFullInput && initialPhase === "done" && (
                <div className="flex justify-start">
                  <div className="w-full rounded-xl border border-border bg-aqua/30 p-3 shadow-card">
                    {files.length > 0 && (
                      <p className="mb-2 text-xs text-primary">
                        {files.length} photo{files.length > 1 ? "s" : ""} attached
                      </p>
                    )}
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0 rounded-lg border border-border bg-surface p-2.5 text-primary shadow-card transition-colors hover:bg-aqua/30"
                        title="Attach photo"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                      </button>
                      <textarea
                        rows={1}
                        placeholder="Describe your issue..."
                        className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink shadow-card transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onFocus={(e) => { e.currentTarget.rows = 4; }}
                        onBlur={(e) => { if (!e.currentTarget.value.trim()) e.currentTarget.rows = 1; }}
                        onInput={(e) => {
                          const ta = e.currentTarget;
                          ta.style.height = "auto";
                          ta.style.height = `${ta.scrollHeight}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            setInputSource("chat");
                            formRef.current?.requestSubmit();
                          }
                        }}
                        disabled={loading}
                      />
                      <button
                        type="button"
                        disabled={loading || (!input.trim() && files.length === 0)}
                        onClick={() => {
                          setInputSource("chat");
                          formRef.current?.requestSubmit();
                        }}
                        className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-[1.25rem] bg-aqua px-4 py-3 shadow-card">
                    <div className="flex gap-2">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              ref={formRef}
              onSubmit={sendMessage}
              className={`${showFullInput ? "" : "mt-4"} flex items-end gap-2 safe-bottom`}
            >
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const newFiles = Array.from(e.target.files ?? []);
                  setFiles((prev) => [...prev, ...newFiles]);
                  e.target.value = "";
                }}
              />
              <input
                type="file"
                ref={requestFileInputRef}
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const newFiles = Array.from(e.target.files ?? []);
                  setFiles((prev) => [...prev, ...newFiles]);
                  e.target.value = "";
                  if (activePhotoRequestId) {
                    updateRequestInput(activePhotoRequestId, `${newFiles.length} photo(s) attached`);
                    setActivePhotoRequestId(null);
                  }
                }}
              />
              {showTextOnlyInput && (
                <>
                  <textarea
                    rows={1}
                    placeholder="Type your message..."
                    className="flex-1 resize-none rounded-lg border border-border bg-surface px-4 py-2.5 text-ink placeholder:text-muted transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={(e) => { e.currentTarget.rows = 4; }}
                    onBlur={(e) => { if (!e.currentTarget.value.trim()) e.currentTarget.rows = 1; }}
                    onInput={(e) => {
                      const ta = e.currentTarget;
                      ta.style.height = "auto";
                      ta.style.height = `${ta.scrollHeight}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        formRef.current?.requestSubmit();
                      }
                    }}
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    onClick={() => setInputSource("chat")}
                    className="min-h-[44px] self-end rounded-lg bg-primary px-4 py-2.5 text-white hover:bg-primary-hover disabled:opacity-50"
                  >
                    Send
                  </button>
                </>
              )}
              {allowAddNote && !addNoteOpen && !showTextOnlyInput && !showFullInput && (
                <button
                  type="button"
                  onClick={() => setAddNoteOpen(true)}
                  className="text-sm text-primary underline underline-offset-2 hover:text-primary-hover"
                >
                  Have something to add?
                </button>
              )}
              {allowAddNote && addNoteOpen && (
                <>
                  <textarea
                    rows={1}
                    placeholder="Add a note..."
                    className="flex-1 resize-none rounded-lg border border-border bg-surface px-4 py-2.5 text-ink placeholder:text-muted transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onFocus={(e) => { e.currentTarget.rows = 4; }}
                    onBlur={(e) => { if (!e.currentTarget.value.trim()) e.currentTarget.rows = 1; }}
                    onInput={(e) => {
                      const ta = e.currentTarget;
                      ta.style.height = "auto";
                      ta.style.height = `${ta.scrollHeight}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        formRef.current?.requestSubmit();
                      }
                    }}
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    onClick={() => setInputSource("note")}
                    className="min-h-[44px] self-end rounded-lg bg-primary px-4 py-2.5 text-white hover:bg-primary-hover disabled:opacity-50"
                  >
                    Send note
                  </button>
                </>
              )}
            </form>
          </>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative flex max-h-[90vh] max-w-[90vw] items-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute -right-3 -top-3 z-10 rounded-full bg-surface p-1.5 shadow-lg hover:bg-page"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-ink" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {lightbox.images.length > 1 && (
              <button
                type="button"
                disabled={lightbox.index === 0}
                onClick={() => setLightbox((prev) => prev && prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev)}
                className="mr-3 shrink-0 rounded-full bg-surface/90 p-2.5 shadow-lg transition-opacity hover:bg-surface disabled:opacity-30"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-ink" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}

            <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.images[lightbox.index]}
                alt={`Guide image ${lightbox.index + 1} of ${lightbox.images.length}`}
                className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain shadow-2xl"
              />
              {lightbox.images.length > 1 && (
                <span className="mt-3 rounded-full bg-ink/60 px-3 py-1 text-xs font-medium text-white">
                  {lightbox.index + 1} / {lightbox.images.length}
                </span>
              )}
            </div>

            {lightbox.images.length > 1 && (
              <button
                type="button"
                disabled={lightbox.index === lightbox.images.length - 1}
                onClick={() => setLightbox((prev) => prev && prev.index < prev.images.length - 1 ? { ...prev, index: prev.index + 1 } : prev)}
                className="ml-3 shrink-0 rounded-full bg-surface/90 p-2.5 shadow-lg transition-opacity hover:bg-surface disabled:opacity-30"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-ink" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {openCitation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4"
          onClick={() => setOpenCitation(null)}
        >
          <div
            className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-card bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <h3 className="text-sm font-semibold text-ink">
                Referenced content
              </h3>
              <button
                type="button"
                onClick={() => setOpenCitation(null)}
                className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-aqua/30 hover:text-ink"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="whitespace-pre-wrap rounded-lg border border-border bg-aqua/20 p-4 text-sm text-ink/80">
              {openCitation.content}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {openCitation.documentId ? (
                <Link
                  href={`/admin/docs/${openCitation.documentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-xs text-primary hover:underline"
                  title={`View document (chunk ${openCitation.chunkId})`}
                >
                  {openCitation.chunkId}
                </Link>
              ) : (
                <p className="truncate font-mono text-xs text-muted" title={openCitation.chunkId}>
                  {openCitation.chunkId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
