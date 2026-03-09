const OPENAI_TPM_WINDOW_MS = 60_000;
const DEFAULT_OPENAI_TPM_LIMIT = 30_000;
const DEFAULT_OPENAI_TPM_HEADROOM = 3_000;
const ESTIMATED_TOKENS_PER_IMAGE = 700;
const ESTIMATED_TOKENS_PER_CHAR_DIVISOR = 4;

type TokenReservation = {
  reservedAt: number;
  tokens: number;
};

let tokenReservations: TokenReservation[] = [];
let reservationChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConfiguredTpmLimit(): number {
  const raw = Number(process.env.OPENAI_TPM_LIMIT ?? DEFAULT_OPENAI_TPM_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : DEFAULT_OPENAI_TPM_LIMIT;
}

function getConfiguredHeadroom(limit: number): number {
  const raw = Number(
    process.env.OPENAI_TPM_HEADROOM ?? DEFAULT_OPENAI_TPM_HEADROOM
  );
  if (Number.isFinite(raw) && raw >= 0) {
    return Math.min(Math.ceil(raw), Math.max(0, limit - 1000));
  }
  return Math.min(DEFAULT_OPENAI_TPM_HEADROOM, Math.max(0, limit - 1000));
}

function pruneExpiredReservations(now: number): void {
  tokenReservations = tokenReservations.filter(
    (reservation) => now - reservation.reservedAt < OPENAI_TPM_WINDOW_MS
  );
}

function getReservedTokens(now: number): number {
  pruneExpiredReservations(now);
  return tokenReservations.reduce(
    (sum, reservation) => sum + reservation.tokens,
    0
  );
}

async function awaitLocalTpmBudget(
  operation: string,
  requestedTokens: number
): Promise<void> {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.OPENAI_DISABLE_LOCAL_TPM_GATE === "1" ||
    requestedTokens <= 0
  ) {
    return;
  }

  const limit = getConfiguredTpmLimit();
  const usableBudget = Math.max(1000, limit - getConfiguredHeadroom(limit));
  const normalizedRequest = Math.min(Math.max(1, Math.ceil(requestedTokens)), usableBudget);

  const acquire = async () => {
    while (true) {
      const now = Date.now();
      const used = getReservedTokens(now);
      if (used + normalizedRequest <= usableBudget) {
        tokenReservations.push({
          reservedAt: now,
          tokens: normalizedRequest,
        });
        return;
      }

      const oldest = tokenReservations[0];
      const waitMs = oldest
        ? Math.max(250, OPENAI_TPM_WINDOW_MS - (now - oldest.reservedAt) + 50)
        : 1000;
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[openai] ${operation} waiting ${waitMs}ms for local TPM budget (${used}/${usableBudget} reserved, request=${normalizedRequest})`
        );
      }
      await sleep(waitMs);
    }
  };

  const reservation = reservationChain.then(acquire);
  reservationChain = reservation.catch(() => {});
  await reservation;
}

export function estimateOpenAITextTokens(value: string): number {
  const normalized = value.replace(/\u0000/g, "");
  if (!normalized) return 0;
  return Math.max(
    1,
    Math.ceil(normalized.length / ESTIMATED_TOKENS_PER_CHAR_DIVISOR)
  );
}

export function estimateOpenAIRequestTokens(input: {
  texts?: Array<string | null | undefined>;
  imageCount?: number;
  maxCompletionTokens?: number;
}): number {
  const textTokens = (input.texts ?? []).reduce(
    (sum, value) => sum + estimateOpenAITextTokens(value ?? ""),
    0
  );
  const imageTokens =
    Math.max(0, input.imageCount ?? 0) * ESTIMATED_TOKENS_PER_IMAGE;
  const completionTokens = Math.max(0, input.maxCompletionTokens ?? 0);
  // Small fixed cushion for JSON schema / message wrappers.
  return textTokens + imageTokens + completionTokens + 100;
}

function getRetryDelayMs(error: unknown, attempt: number): number | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/insufficient_quota/i.test(message)) {
    return null;
  }
  if (!/429|rate limit/i.test(message)) {
    return null;
  }

  const hintedDelay = message.match(/try again in\s+([0-9.]+)s/i);
  if (hintedDelay) {
    const seconds = Number(hintedDelay[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(20_000, Math.max(500, Math.ceil(seconds * 1000) + 250));
    }
  }

  return Math.min(15_000, 1000 * 2 ** attempt);
}

export async function withOpenAIRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  options?: {
    estimatedTokens?: number;
  }
): Promise<T> {
  const maxAttempts = Math.max(
    1,
    Number(process.env.OPENAI_RETRY_ATTEMPTS ?? 4)
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await awaitLocalTpmBudget(operation, options?.estimatedTokens ?? 0);
      return await fn();
    } catch (error) {
      lastError = error;
      const delayMs = getRetryDelayMs(error, attempt);
      if (delayMs == null || attempt === maxAttempts - 1) {
        throw error;
      }
      if (process.env.NODE_ENV !== "test") {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[openai] ${operation} hit a retriable rate limit on attempt ${attempt + 1}/${maxAttempts}; retrying in ${delayMs}ms: ${message}`
        );
      }
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? `${operation} failed`));
}
