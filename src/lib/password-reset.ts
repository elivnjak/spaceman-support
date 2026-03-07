import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { authPasswordResetAttempts, passwordResetTokens, users } from "@/lib/db/schema";

export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
export const PASSWORD_RESET_TOKEN_TTL_MS = PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000;

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createPasswordResetToken(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await db.insert(passwordResetTokens).values({
    userId,
    token: hashPasswordResetToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

export async function findPasswordResetToken(rawToken: string): Promise<{
  id: string;
  userId: string;
  email: string;
  expiresAt: Date;
} | null> {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  const rows = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      email: users.email,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(eq(passwordResetTokens.token, hashPasswordResetToken(trimmed)))
    .limit(1);

  const record = rows[0];
  if (!record) return null;

  if (record.expiresAt.getTime() <= Date.now()) {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, record.id));
    return null;
  }

  return record;
}

export async function deletePasswordResetTokensForUser(userId: string): Promise<void> {
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
}

export async function logPasswordResetAttempt(input: {
  action: string;
  outcome: string;
  email?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
}): Promise<void> {
  await db.insert(authPasswordResetAttempts).values({
    action: input.action,
    outcome: input.outcome,
    email: input.email?.trim().toLowerCase() || null,
    userId: input.userId ?? null,
    ipAddress: input.ipAddress?.trim() || null,
  });
}