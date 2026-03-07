import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  deleteSessionsForUser,
  hashPassword,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { clearFailedLoginAttempts } from "@/lib/login-security";
import {
  deletePasswordResetTokensForUser,
  findPasswordResetToken,
  getClientIp,
  logPasswordResetAttempt,
} from "@/lib/password-reset";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-server";

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`),
});

async function POSTHandler(request: Request) {
  const ipAddress = getClientIp(request);
  const limit = RATE_LIMITS.passwordResetConfirmPerIp;
  const ipRateLimit = await checkRateLimit(
    `auth:reset-password:ip:${ipAddress}`,
    limit.maxRequests,
    limit.windowMs
  );
  if (!ipRateLimit.allowed) {
    await logPasswordResetAttempt({
      action: "confirm",
      outcome: "rate_limited_ip",
      ipAddress,
    });
    return NextResponse.json(
      { error: "Too many reset attempts. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipRateLimit.resetMs / 1000)),
        },
      }
    );
  }

  let body: z.infer<typeof resetPasswordSchema>;
  try {
    body = resetPasswordSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: `Invalid request. Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  const record = await findPasswordResetToken(body.token);
  if (!record) {
    await logPasswordResetAttempt({
      action: "confirm",
      outcome: "invalid_token",
      ipAddress,
    });
    return NextResponse.json(
      { error: "This password reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(body.password);
  const [updated] = await db
    .update(users)
    .set({
      passwordHash,
      forcePasswordChange: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, record.userId))
    .returning({ id: users.id });

  if (!updated) {
    await logPasswordResetAttempt({
      action: "confirm",
      outcome: "user_not_found",
      email: record.email,
      userId: record.userId,
      ipAddress,
    });
    return NextResponse.json(
      { error: "This password reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  await deletePasswordResetTokensForUser(record.userId);
  await deleteSessionsForUser(record.userId);
  await clearFailedLoginAttempts(record.email);
  await logPasswordResetAttempt({
    action: "confirm",
    outcome: "success",
    email: record.email,
    userId: record.userId,
    ipAddress,
  });

  return NextResponse.json({ ok: true });
}

export const POST = withApiRouteErrorLogging("/api/auth/reset-password", POSTHandler);
