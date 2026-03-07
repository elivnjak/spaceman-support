import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";

const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-session_token"
    : "session_token";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24; // 24 hours
export const PASSWORD_MIN_LENGTH = 12;
export const ADMIN_ROLE = "admin";
export const EDITOR_ROLE = "editor";
export type AdminUiRole = typeof ADMIN_ROLE | typeof EDITOR_ROLE;
const ADMIN_UI_ROLES = new Set<AdminUiRole>([ADMIN_ROLE, EDITOR_ROLE]);

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

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function rotateSessionToken(
  token: string
): Promise<{ token: string; expiresAt: Date } | null> {
  const nextToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const [updated] = await db
    .update(sessions)
    .set({
      token: nextToken,
      expiresAt,
    })
    .where(eq(sessions.token, token))
    .returning({ token: sessions.token, expiresAt: sessions.expiresAt });
  return updated ?? null;
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

export function isAdminRole(role: string | null | undefined): role is typeof ADMIN_ROLE {
  return role === ADMIN_ROLE;
}

export function hasAdminUiAccess(role: string | null | undefined): role is AdminUiRole {
  if (!role) return false;
  return ADMIN_UI_ROLES.has(role as AdminUiRole);
}

export function normalizeAdminUiRole(role: unknown): AdminUiRole | null {
  if (typeof role !== "string") return null;
  const normalized = role.trim().toLowerCase();
  return hasAdminUiAccess(normalized) ? normalized : null;
}

export async function requireAdminUiAuth(request: Request): Promise<NextResponse | null> {
  const session = await getSessionFromRequest(request);
  if (!session || !hasAdminUiAccess(session.user.role)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
  return null;
}

/**
 * Validates the admin session cookie from the request.
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export async function requireAdminAuth(request: Request): Promise<NextResponse | null> {
  const session = await getSessionFromRequest(request);
  if (!session || !isAdminRole(session.user.role)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
  return null;
}

