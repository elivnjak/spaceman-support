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

function requestViaHttpsIpv4(opts: {
  url: string;
  method: "GET" | "POST";
  payload?: unknown;
  timeoutMs: number;
}): Promise<TelegramApiResult> {
  const { url, method, payload, timeoutMs } = opts;
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        family: 4,
        timeout: timeoutMs,
        headers:
          body === undefined
            ? undefined
            : {
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
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function postJsonViaHttpsIpv4(
  url: string,
  payload: unknown,
  timeoutMs: number
): Promise<TelegramApiResult> {
  return requestViaHttpsIpv4({ url, method: "POST", payload, timeoutMs });
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

export async function getTelegramJson(
  token: string,
  method: string,
  searchParams?: Record<string, string | number | boolean | undefined>,
  timeoutMs = 12000
): Promise<TelegramApiResult> {
  const url = new URL(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body: text,
      transport: "fetch",
    };
  } catch (err) {
    const fallback = await requestViaHttpsIpv4({
      url: url.toString(),
      method: "GET",
      timeoutMs,
    });
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
