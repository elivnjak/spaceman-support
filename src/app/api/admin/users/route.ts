import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAdminLoginUrl,
  buildResetPasswordUrl,
  resolveAppBaseUrl,
  sendUserInvitationEmail,
} from "@/lib/auth-email";
import {
  EDITOR_ROLE,
  hashPassword,
  normalizeAdminUiRole,
  PASSWORD_MIN_LENGTH,
  requireAdminAuth,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { createPasswordResetToken } from "@/lib/password-reset";

const createUserSchema = z.object({
  email: z.string().trim().email(),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`),
  role: z.string().optional(),
  sendEmail: z.boolean().optional(),
});

async function GETHandler(request: Request) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const list = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    forcePasswordChange: users.forcePasswordChange,
    createdAt: users.createdAt,
  }).from(users);
  return NextResponse.json(list);
}

async function POSTHandler(request: Request) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  let body: z.infer<typeof createUserSchema>;
  try {
    body = createUserSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid request body. email must be valid and password must be at least 12 characters.",
      },
      { status: 400 }
    );
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const role = body.role === undefined ? EDITOR_ROLE : normalizeAdminUiRole(body.role);
  const sendEmail = body.sendEmail === true;

  if (!role) {
    return NextResponse.json(
      { error: "role must be 'admin' or 'editor'" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);
  try {
    const [inserted] = await db
      .insert(users)
      .values({ email, passwordHash, role, forcePasswordChange: true })
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        forcePasswordChange: users.forcePasswordChange,
        createdAt: users.createdAt,
      });

    let warning: string | undefined;
    if (sendEmail) {
      const baseUrl = resolveAppBaseUrl(request);
      if (!baseUrl) {
        warning = "User created, but the invitation email could not be sent because the app URL is not configured.";
      } else {
        const { token } = await createPasswordResetToken(inserted.id);
        const emailResult = await sendUserInvitationEmail({
          to: inserted.email,
          loginUrl: buildAdminLoginUrl(baseUrl),
          resetUrl: buildResetPasswordUrl(baseUrl, token),
          temporaryPassword: password,
        });
        if (!emailResult.sent) {
          warning = `User created, but the invitation email could not be sent${emailResult.error ? `: ${emailResult.error}` : "."}`;
        }
      }
    }

    return NextResponse.json(warning ? { ...inserted, warning } : inserted);
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
    }
    throw err;
  }
}

export const GET = withApiRouteErrorLogging("/api/admin/users", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/users", POSTHandler);
