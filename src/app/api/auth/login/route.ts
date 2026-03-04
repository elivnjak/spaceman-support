import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import {
  createSession,
  getSessionCookieName,
  hasAdminUiAccess,
  verifyPassword,
} from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import {
  clearFailedLoginAttempts,
  getLoginLockStatus,
  recordFailedLoginAttempt,
} from "@/lib/login-security";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-server";

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

async function POSTHandler(request: Request) {
  const ip = getClientIp(request);
  const limit = RATE_LIMITS.adminPerIp;
  const ipRateLimit = await checkRateLimit(
    `auth:login:${ip}`,
    limit.maxRequests,
    limit.windowMs
  );
  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait before trying again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipRateLimit.resetMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const lockStatus = await getLoginLockStatus(email);
  if (lockStatus.isLocked) {
    return NextResponse.json(
      { error: "Too many failed login attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(lockStatus.retryAfterMs / 1000)),
        },
      }
    );
  }

  let userRows: User[];
  try {
    userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json(
        { error: "Database not set up. Run migrations and seed (e.g. npm run railway:setup:prod)." },
        { status: 503 }
      );
    }
    throw err;
  }
  const user = userRows[0];
  if (!user || !hasAdminUiAccess(user.role)) {
    await recordFailedLoginAttempt(email);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    await recordFailedLoginAttempt(email);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await clearFailedLoginAttempts(email);

  const { token, expiresAt } = await createSession(user.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}

export const POST = withApiRouteErrorLogging("/api/auth/login", POSTHandler);
