type TurnstileVerifyResult = {
  success: boolean;
  "error-codes"?: string[];
};

type VerifyTurnstileInput = {
  token: string | null;
  remoteIp?: string | null;
};

export async function verifyTurnstileToken(
  input: VerifyTurnstileInput
): Promise<{ ok: boolean; errorCodes: string[] }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const enforceInCurrentEnv =
    process.env.NODE_ENV === "production" ||
    process.env.TURNSTILE_ENFORCE?.trim().toLowerCase() === "true";

  // Enforce only when both keys are configured in this environment.
  // This prevents public chat from hard-failing if deployment vars are partial.
  if (!secret || !siteKey || !enforceInCurrentEnv) {
    return { ok: true, errorCodes: [] };
  }

  const token = input.token?.trim();
  if (!token) {
    return { ok: false, errorCodes: ["missing-input-response"] };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });

  const remoteIp = input.remoteIp?.trim();
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );

    if (!response.ok) {
      return { ok: false, errorCodes: ["turnstile-unreachable"] };
    }

    const data = (await response.json()) as TurnstileVerifyResult;
    return { ok: data.success === true, errorCodes: data["error-codes"] ?? [] };
  } catch {
    return { ok: false, errorCodes: ["turnstile-unreachable"] };
  }
}
