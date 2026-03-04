import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const MAX_FAILED_LOGIN_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

type LoginAttemptRow = {
  failed_attempts: number;
  locked_until: Date | string | null;
};

let ensureTablePromise: Promise<void> | null = null;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

async function ensureLoginAttemptsTable(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS auth_login_attempts (
          email text PRIMARY KEY,
          failed_attempts integer NOT NULL DEFAULT 0,
          last_failed_at timestamp with time zone,
          locked_until timestamp with time zone,
          updated_at timestamp with time zone NOT NULL DEFAULT now()
        )
      `)
      .then(() => undefined);
  }
  await ensureTablePromise;
}

export async function getLoginLockStatus(email: string): Promise<{
  isLocked: boolean;
  retryAfterMs: number;
}> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { isLocked: false, retryAfterMs: 0 };

  await ensureLoginAttemptsTable();
  const result = await db.execute(
    sql`SELECT failed_attempts, locked_until FROM auth_login_attempts WHERE email = ${normalizedEmail} LIMIT 1`
  );
  const row = extractRows<LoginAttemptRow>(result)[0];
  if (!row?.locked_until) return { isLocked: false, retryAfterMs: 0 };

  const lockedUntilMs = new Date(row.locked_until).getTime();
  const now = Date.now();
  if (!Number.isFinite(lockedUntilMs) || lockedUntilMs <= now) {
    return { isLocked: false, retryAfterMs: 0 };
  }

  return { isLocked: true, retryAfterMs: lockedUntilMs - now };
}

export async function recordFailedLoginAttempt(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  await ensureLoginAttemptsTable();
  await db.execute(sql`
    INSERT INTO auth_login_attempts (
      email,
      failed_attempts,
      last_failed_at,
      locked_until,
      updated_at
    )
    VALUES (
      ${normalizedEmail},
      1,
      now(),
      NULL,
      now()
    )
    ON CONFLICT (email) DO UPDATE
    SET
      failed_attempts = CASE
        WHEN auth_login_attempts.locked_until IS NOT NULL
          AND auth_login_attempts.locked_until > now()
          THEN auth_login_attempts.failed_attempts
        WHEN auth_login_attempts.locked_until IS NOT NULL
          AND auth_login_attempts.locked_until <= now()
          THEN 1
        ELSE auth_login_attempts.failed_attempts + 1
      END,
      last_failed_at = now(),
      locked_until = CASE
        WHEN auth_login_attempts.locked_until IS NOT NULL
          AND auth_login_attempts.locked_until > now()
          THEN auth_login_attempts.locked_until
        WHEN (
          CASE
            WHEN auth_login_attempts.locked_until IS NOT NULL
              AND auth_login_attempts.locked_until <= now()
              THEN 1
            ELSE auth_login_attempts.failed_attempts + 1
          END
        ) >= ${MAX_FAILED_LOGIN_ATTEMPTS}
          THEN now() + (${LOCKOUT_MINUTES} * interval '1 minute')
        ELSE NULL
      END,
      updated_at = now()
  `);
}

export async function clearFailedLoginAttempts(email: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  await ensureLoginAttemptsTable();
  await db.execute(
    sql`DELETE FROM auth_login_attempts WHERE email = ${normalizedEmail}`
  );
}
