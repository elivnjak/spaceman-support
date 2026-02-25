/**
 * Simple in-memory sliding-window rate limiter.
 * For production, replace with Redis-backed implementation.
 */

type RateLimitEntry = {
  timestamps: number[];
};

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

/**
 * Check and consume a rate limit token.
 * @param key Unique key (e.g. IP address, session ID)
 * @param maxRequests Max requests in the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  cleanup(windowMs);
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldest + windowMs - now,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs,
  };
}

export const RATE_LIMITS = {
  /** Max chat messages per session per minute */
  chatPerSession: { maxRequests: 10, windowMs: 60_000 },
  /** Max chat messages per IP per minute */
  chatPerIp: { maxRequests: 30, windowMs: 60_000 },
  /** Max admin requests per IP per minute */
  adminPerIp: { maxRequests: 60, windowMs: 60_000 },
} as const;
