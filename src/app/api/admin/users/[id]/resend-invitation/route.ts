import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  buildAdminLoginUrl,
  buildResetPasswordUrl,
  resolveAppBaseUrl,
  sendUserInvitationEmail,
} from "@/lib/auth-email";
import { requireAdminAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { createPasswordResetToken } from "@/lib/password-reset";

type RouteParams = { params: Promise<{ id: string }> };

async function POSTHandler(request: Request, { params }: RouteParams) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "User id required" }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const baseUrl = resolveAppBaseUrl(request);
  if (!baseUrl) {
    return NextResponse.json(
      { error: "Unable to determine the app URL for invitation emails." },
      { status: 500 }
    );
  }

  const { token } = await createPasswordResetToken(user.id);
  const emailResult = await sendUserInvitationEmail({
    to: user.email,
    loginUrl: buildAdminLoginUrl(baseUrl),
    resetUrl: buildResetPasswordUrl(baseUrl, token),
  });

  if (!emailResult.sent) {
    return NextResponse.json(
      {
        error: `Invitation email could not be sent${emailResult.error ? `: ${emailResult.error}` : "."}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

export const POST = withApiRouteErrorLogging(
  "/api/admin/users/[id]/resend-invitation",
  POSTHandler
);