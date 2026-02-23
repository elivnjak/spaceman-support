import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";

const SESSION_COOKIE_NAME = "session_token";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const target = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }
  return null;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(sessions).values({
    userId,
    token,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function validateSession(
  token: string
): Promise<{ user: User; expiresAt: Date } | null> {
  const now = new Date();
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);

  const session = sessionRows[0];
  if (!session) {
    await db.delete(sessions).where(eq(sessions.token, token));
    return null;
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    await deleteSession(token);
    return null;
  }

  return { user, expiresAt: session.expiresAt };
}

export async function getSessionFromRequest(
  request: Request
): Promise<{ user: User; token: string; expiresAt: Date } | null> {
  const token = getCookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!token) return null;
  const session = await validateSession(token);
  if (!session) return null;
  return { user: session.user, token, expiresAt: session.expiresAt };
}

/**
 * Validates the admin session cookie from the request.
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export async function requireAdminAuth(request: Request): Promise<NextResponse | null> {
  const session = await getSessionFromRequest(request);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
  return null;
}

