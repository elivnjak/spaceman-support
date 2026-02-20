import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Middleware protecting admin UI (basic auth) and admin API routes (Bearer token).
 * Chat API routes use a separate CHAT_API_KEY if configured.
 * All API routes are rate-limited.
 *
 * Set ADMIN_API_KEY and optionally CHAT_API_KEY in .env to enable.
 * When keys are not set, access is unrestricted (dev mode).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Admin UI: basic auth challenge via browser ---
  if (pathname.startsWith("/admin")) {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) return NextResponse.next();

    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Basic ")) {
      const decoded = atob(authHeader.slice(6));
      const [, password] = decoded.split(":");
      if (password === adminKey) return NextResponse.next();
    }

    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
    });
  }

  // --- Admin API routes: Bearer token ---
  if (pathname.startsWith("/api/admin")) {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) return NextResponse.next();

    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    // Also accept Basic auth (so admin UI fetch calls pass through)
    if (authHeader?.startsWith("Basic ")) {
      const decoded = atob(authHeader.slice(6));
      const [, password] = decoded.split(":");
      if (password === adminKey) return NextResponse.next();
    }

    if (token !== adminKey) {
      return NextResponse.json(
        { error: "Invalid or missing admin API key" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // --- Chat + Analyse API routes: Bearer token + rate limiting ---
  if (pathname.startsWith("/api/chat") || pathname.startsWith("/api/analyse")) {
    const chatKey = process.env.CHAT_API_KEY;
    if (chatKey) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      if (token !== chatKey) {
        return NextResponse.json(
          { error: "Invalid or missing chat API key" },
          { status: 401 }
        );
      }
    }

    // Rate limit by IP
    if (request.method === "POST") {
      const ip = getClientIp(request);
      const limit = pathname.startsWith("/api/chat")
        ? RATE_LIMITS.chatPerIp
        : RATE_LIMITS.analysePerIp;
      const result = checkRateLimit(`ip:${pathname}:${ip}`, limit.maxRequests, limit.windowMs);
      if (!result.allowed) {
        return NextResponse.json(
          { error: "Too many requests. Please wait before trying again." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(result.resetMs / 1000)),
              "X-RateLimit-Remaining": "0",
            },
          }
        );
      }
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/chat/:path*", "/api/analyse/:path*"],
};
