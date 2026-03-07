import { createHmac, timingSafeEqual } from "crypto";

type ChatAccessTokenPayload = {
  sid: string;
  exp: number;
  v: 1;
};

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function getSigningSecret(): string {
  const secret =
    process.env.CHAT_SESSION_TOKEN_SECRET?.trim() ||
    process.env.TURNSTILE_SECRET_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!secret) {
    throw new Error(
      "CHAT_SESSION_TOKEN_SECRET (or TURNSTILE_SECRET_KEY/OPENAI_API_KEY fallback) is required for chat session tokens."
    );
  }
  return secret;
}

function toBase64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

function signPayload(encodedPayload: string, secret: string): string {
  return toBase64Url(
    createHmac("sha256", secret).update(encodedPayload).digest()
  );
}

export function issueChatSessionToken(
  sessionId: string,
  ttlMs = DEFAULT_TTL_MS
): string {
  const payload: ChatAccessTokenPayload = {
    sid: sessionId,
    exp: Date.now() + Math.max(60_000, ttlMs),
    v: 1,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, getSigningSecret());
  return `${encodedPayload}.${signature}`;
}

export function verifyChatSessionToken(
  token: string | null | undefined,
  sessionId: string
): boolean {
  if (!token || !sessionId) return false;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;

  let payload: ChatAccessTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8"));
  } catch {
    return false;
  }

  if (
    !payload ||
    payload.v !== 1 ||
    payload.sid !== sessionId ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= Date.now()
  ) {
    return false;
  }

  const expected = signPayload(encodedPayload, getSigningSecret());
  const sigA = Buffer.from(signature);
  const sigB = Buffer.from(expected);
  if (sigA.length !== sigB.length) return false;
  return timingSafeEqual(sigA, sigB);
}

export function readChatSessionTokenFromRequest(request: Request): string | null {
  const headerToken = request.headers.get("x-chat-session-token")?.trim();
  if (headerToken) return headerToken;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token")?.trim();
  return queryToken || null;
}
