import { checkRateLimit as checkInMemoryRateLimit, type RateLimitResult } from "@/lib/rate-limit";

type Redis = {
  [key: string]: unknown;
};

type Ratelimit = {
  limit: (
    key: string
  ) => Promise<{ success: boolean; remaining: number; reset: number }>;
};

const redisLimiters = new Map<string, Ratelimit>();
let redisClient: Redis | null = null;
let redisUnavailableLogged = false;

function isRedisRateLimitingEnabled(): boolean {
  const provider = process.env.RATE_LIMIT_PROVIDER?.trim().toLowerCase();
  return provider === "redis";
}

async function getRedisClient(): Promise<Redis | null> {
  if (!isRedisRateLimitingEnabled()) return null;
  if (redisClient) return redisClient;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!redisUrl || !redisToken) return null;

  const mod = await import("@upstash/redis");
  redisClient = new mod.Redis({
    url: redisUrl,
    token: redisToken,
  }) as unknown as Redis;
  return redisClient;
}

function toRatelimitDuration(windowMs: number): `${number} s` {
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));
  return `${seconds} s`;
}

async function getRedisLimiter(
  maxRequests: number,
  windowMs: number
): Promise<Ratelimit | null> {
  const client = await getRedisClient();
  if (!client) return null;

  const limiterKey = `${maxRequests}:${windowMs}`;
  const existing = redisLimiters.get(limiterKey);
  if (existing) return existing;

  const mod = await import("@upstash/ratelimit");
  const created = new mod.Ratelimit({
    redis: client as never,
    limiter: mod.Ratelimit.slidingWindow(
      maxRequests,
      toRatelimitDuration(windowMs)
    ),
    analytics: true,
    prefix: "rate_limit",
  }) as unknown as Ratelimit;
  redisLimiters.set(limiterKey, created);
  return created;
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const limiter = await getRedisLimiter(maxRequests, windowMs);
  if (!limiter) {
    return checkInMemoryRateLimit(key, maxRequests, windowMs);
  }

  try {
    const result = await limiter.limit(key);
    const now = Date.now();
    return {
      allowed: result.success,
      remaining: Math.max(0, result.remaining),
      resetMs: Math.max(0, result.reset - now),
    };
  } catch {
    if (!redisUnavailableLogged) {
      redisUnavailableLogged = true;
      console.warn(
        "[rate-limit] Redis rate limiting unavailable; falling back to in-memory store."
      );
    }
    return checkInMemoryRateLimit(key, maxRequests, windowMs);
  }
}
