import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hasAdminUiAccess } from "@/lib/auth";
import {
  buildResetPasswordUrl,
  resolveAppBaseUrl,
  sendPasswordResetEmail,
} from "@/lib/auth-email";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import {
  createPasswordResetToken,
  getClientIp,
  logPasswordResetAttempt,
} from "@/lib/password-reset";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-server";

const requestSchema = z.object({
  email: z.string().trim().email(),
});

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

async function POSTHandler(request: Request) {
  const ipAddress = getClientIp(request);

  const ipLimit = RATE_LIMITS.passwordResetRequestPerIp;
  const ipRateLimit = await checkRateLimit(
    `auth:forgot-password:ip:${ipAddress}`,
    ipLimit.maxRequests,
    ipLimit.windowMs
  );
  if (!ipRateLimit.allowed) {
    await logPasswordResetAttempt({
      action: "request",
      outcome: "rate_limited_ip",
      ipAddress,
    });
    return NextResponse.json(
      { error: "Too many password reset requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipRateLimit.resetMs / 1000)),
        },
      }
    );
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const emailLimit = RATE_LIMITS.passwordResetRequestPerEmail;
  const emailRateLimit = await checkRateLimit(
    `auth:forgot-password:email:${email}`,
    emailLimit.maxRequests,
    emailLimit.windowMs
  );
  if (!emailRateLimit.allowed) {
    await logPasswordResetAttempt({
      action: "request",
      outcome: "rate_limited_email",
      email,
      ipAddress,
    });
    return NextResponse.json(
      { error: "Too many password reset requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(emailRateLimit.resetMs / 1000)),
        },
      }
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !hasAdminUiAccess(user.role)) {
    await logPasswordResetAttempt({
      action: "request",
      outcome: "ignored_unknown_email",
      email,
      ipAddress,
    });
    return NextResponse.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
  }

  const { token } = await createPasswordResetToken(user.id);
  const baseUrl = resolveAppBaseUrl(request);
  if (!baseUrl) {
    console.error("[auth/forgot-password] Unable to resolve app base URL.");
    await logPasswordResetAttempt({
      action: "request",
      outcome: "email_failed",
      email: user.email,
      userId: user.id,
      ipAddress,
    });
    return NextResponse.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
  }

  const emailResult = await sendPasswordResetEmail({
    to: user.email,
    resetUrl: buildResetPasswordUrl(baseUrl, token),
  });

  await logPasswordResetAttempt({
    action: "request",
    outcome: emailResult.sent ? "email_sent" : "email_failed",
    email: user.email,
    userId: user.id,
    ipAddress,
  });

  return NextResponse.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
}

export const POST = withApiRouteErrorLogging("/api/auth/forgot-password", POSTHandler);
