import { PASSWORD_RESET_TOKEN_TTL_MINUTES } from "@/lib/password-reset";

function getBaseUrlFromRequest(request?: Request): string | null {
  if (!request) return null;

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

export function resolveAppBaseUrl(request?: Request): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }

  return getBaseUrlFromRequest(request);
}

function getAuthEmailConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY?.trim(),
    from:
      process.env.AUTH_EMAIL_FROM?.trim() ||
      process.env.ESCALATION_EMAIL_FROM?.trim() ||
      "onboarding@resend.dev",
    replyTo:
      process.env.AUTH_EMAIL_REPLY_TO?.trim() ||
      process.env.ESCALATION_EMAIL_REPLY_TO?.trim() ||
      undefined,
  };
}

async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; error?: string }> {
  const { apiKey, from, replyTo } = getAuthEmailConfig();
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY is not configured." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const detail = `${response.status} ${await response.text()}`.trim();
      console.error(`[auth-email] Email send failed: ${detail}`);
      return { sent: false, error: detail };
    }

    return { sent: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[auth-email] Email request failed:", detail);
    return { sent: false, error: detail };
  }
}

export function buildAdminLoginUrl(baseUrl: string): string {
  return `${baseUrl}/admin/login`;
}

export function buildForgotPasswordUrl(baseUrl: string): string {
  return `${baseUrl}/admin/forgot-password`;
}

export function buildResetPasswordUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(input: {
  to: string;
  resetUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  return sendAuthEmail({
    to: input.to,
    subject: "Reset your Kuhlberg Support password",
    text: [
      "We received a request to reset your Kuhlberg Support password.",
      "",
      `Reset your password: ${input.resetUrl}`,
      `This link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.`,
      "",
      "If you did not request this, you can safely ignore this email.",
    ].join("\n"),
  });
}

export async function sendUserInvitationEmail(input: {
  to: string;
  loginUrl: string;
  resetUrl: string;
  temporaryPassword?: string;
}): Promise<{ sent: boolean; error?: string }> {
  const lines = [
    "A Kuhlberg Support account has been created for you.",
    "",
    `Sign in here: ${input.loginUrl}`,
  ];

  if (input.temporaryPassword) {
    lines.push(`Temporary password: ${input.temporaryPassword}`);
  }

  lines.push(
    "",
    `You can also set a new password directly with this secure link: ${input.resetUrl}`,
    `This setup link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.`,
    "After signing in or setting your password, you will be asked to choose your own password before continuing."
  );

  return sendAuthEmail({
    to: input.to,
    subject: "Your Kuhlberg Support account is ready",
    text: lines.join("\n"),
  });
}

export async function sendAdminPasswordChangedEmail(input: {
  to: string;
  loginUrl: string;
  forgotPasswordUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  return sendAuthEmail({
    to: input.to,
    subject: "Your Kuhlberg Support password was changed",
    text: [
      "An administrator changed your Kuhlberg Support password.",
      "",
      `Sign in here: ${input.loginUrl}`,
      "Use the password provided to you by your administrator.",
      `If you need help or did not expect this change, request a reset here: ${input.forgotPasswordUrl}`,
    ].join("\n"),
  });
}