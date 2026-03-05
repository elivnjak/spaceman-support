import https from "node:https";

export type TelegramApiResult = {
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
  transport?: "fetch" | "https_ipv4";
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err as Error & {
      cause?: { code?: string; message?: string };
      code?: string;
    };
    const code = cause.cause?.code || cause.code;
    if (code) return `${code}: ${cause.message}`;
    return cause.message;
  }
  return String(err);
}

function postJsonViaHttpsIpv4(
  url: string,
  payload: unknown,
  timeoutMs: number
): Promise<TelegramApiResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        family: 4,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk.toString();
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: text,
            transport: "https_ipv4",
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        error: toErrorMessage(err),
        transport: "https_ipv4",
      });
    });
    req.write(body);
    req.end();
  });
}

export async function postTelegramJson(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  timeoutMs = 12000
): Promise<TelegramApiResult> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body: text,
      transport: "fetch",
    };
  } catch (err) {
    const fallback = await postJsonViaHttpsIpv4(url, payload, timeoutMs);
    if (fallback.ok) return fallback;
    return {
      ok: false,
      error: `${toErrorMessage(err)}${fallback.error ? ` | fallback: ${fallback.error}` : ""}`,
      transport: fallback.transport ?? "fetch",
    };
  } finally {
    clearTimeout(timer);
  }
}
