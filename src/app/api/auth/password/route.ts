import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  createSession,
  deleteSessionsForUser,
  getSessionCookieName,
  getSessionFromRequest,
  hasAdminUiAccess,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { clearFailedLoginAttempts } from "@/lib/login-security";
import { deletePasswordResetTokensForUser } from "@/lib/password-reset";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-server";

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`),
});

async function POSTHandler(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !hasAdminUiAccess(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = RATE_LIMITS.passwordChangePerUser;
  const rateLimit = await checkRateLimit(
    `auth:password-change:user:${session.user.id}`,
    limit.maxRequests,
    limit.windowMs
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many password change attempts. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.resetMs / 1000)),
        },
      }
    );
  }

  let body: z.infer<typeof passwordChangeSchema>;
  try {
    body = passwordChangeSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: `Invalid request. Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  const currentPasswordValid = await verifyPassword(
    body.currentPassword,
    session.user.passwordHash
  );
  if (!currentPasswordValid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  if (body.currentPassword === body.newPassword) {
    return NextResponse.json(
      { error: "New password must be different from your current password." },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(body.newPassword);
  await db
    .update(users)
    .set({
      passwordHash,
      forcePasswordChange: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  await deletePasswordResetTokensForUser(session.user.id);
  await clearFailedLoginAttempts(session.user.email);
  await deleteSessionsForUser(session.user.id);

  const { token, expiresAt } = await createSession(session.user.id);
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

export const POST = withApiRouteErrorLogging("/api/auth/password", POSTHandler);
