import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  buildAdminLoginUrl,
  buildForgotPasswordUrl,
  resolveAppBaseUrl,
  sendAdminPasswordChangedEmail,
} from "@/lib/auth-email";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  deleteSessionsForUser,
  getSessionFromRequest,
  getSessionCookieName,
  hashPassword,
  isAdminRole,
  normalizeAdminUiRole,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { clearFailedLoginAttempts } from "@/lib/login-security";
import { deletePasswordResetTokensForUser } from "@/lib/password-reset";

type RouteParams = { params: Promise<{ id: string }> };
const updateUserSchema = z.object({
  email: z.string().trim().email().optional(),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .optional(),
  role: z.string().optional(),
});

async function PATCHHandler(request: Request, { params }: RouteParams) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "User id required" }, { status: 400 });
  }

  let body: z.infer<typeof updateUserSchema>;
  try {
    body = updateUserSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid request body. email must be valid and password must be at least 12 characters.",
      },
      { status: 400 }
    );
  }

  const isSelf = session.user.id === id;
  let passwordChanged = false;
  const updates: {
    email?: string;
    passwordHash?: string;
    role?: string;
    forcePasswordChange?: boolean;
  } = {};
  if (body.email !== undefined) {
    updates.email = (body.email as string).trim().toLowerCase();
    if (!updates.email) {
      return NextResponse.json({ error: "email cannot be empty" }, { status: 400 });
    }
  }
  if (body.password !== undefined && body.password !== "") {
    updates.passwordHash = await hashPassword(body.password as string);
    updates.forcePasswordChange = isSelf ? false : true;
    passwordChanged = true;
  }
  if (body.role !== undefined) {
    const role = normalizeAdminUiRole(body.role);
    if (!role) {
      return NextResponse.json(
        { error: "role must be 'admin' or 'editor'" },
        { status: 400 }
      );
    }
    updates.role = role;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        forcePasswordChange: users.forcePasswordChange,
        createdAt: users.createdAt,
      });
    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let warning: string | undefined;
    let nextSession: { token: string; expiresAt: Date } | null = null;

    if (passwordChanged) {
      await clearFailedLoginAttempts(updated.email);
      await deletePasswordResetTokensForUser(updated.id);
      await deleteSessionsForUser(updated.id);

      if (isSelf) {
        nextSession = await createSession(updated.id);
      } else {
        const baseUrl = resolveAppBaseUrl(request);
        if (!baseUrl) {
          warning = "Password updated, but the notification email could not be sent because the app URL is not configured.";
        } else {
          const emailResult = await sendAdminPasswordChangedEmail({
            to: updated.email,
            loginUrl: buildAdminLoginUrl(baseUrl),
            forgotPasswordUrl: buildForgotPasswordUrl(baseUrl),
          });
          if (!emailResult.sent) {
            warning = `Password updated, but the notification email could not be sent${emailResult.error ? `: ${emailResult.error}` : "."}`;
          }
        }
      }
    }

    const response = NextResponse.json(
      warning ? { ...updated, warning, passwordChanged } : { ...updated, passwordChanged }
    );

    if (nextSession) {
      response.cookies.set(getSessionCookieName(), nextSession.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: nextSession.expiresAt,
      });
    }

    return response;
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
    }
    throw err;
  }
}

async function DELETEHandler(request: Request, { params }: RouteParams) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "User id required" }, { status: 400 });
  }

  if (session.user.id === id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 403 }
    );
  }

  const [deleted] = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!deleted) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiRouteErrorLogging("/api/admin/users/[id]", PATCHHandler);

export const DELETE = withApiRouteErrorLogging("/api/admin/users/[id]", DELETEHandler);

