import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Origin the client sees (use behind proxies e.g. Railway). */
function getRequestOrigin(request: NextRequest): string {
  if (
    process.env.NEXT_PUBLIC_BASE_URL != null &&
    process.env.NEXT_PUBLIC_BASE_URL !== ""
  ) {
    return new URL(process.env.NEXT_PUBLIC_BASE_URL).origin;
  }
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host") ??
    request.nextUrl.host;
  if (proto && host) {
    return `${proto}://${host}`;
  }
  return request.nextUrl.origin;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken = request.cookies.get("session_token")?.value?.trim() ?? "";

  // Allow admin root to render login form when unauthenticated.
  if (pathname === "/admin") {
    return NextResponse.next();
  }

  // --- Admin UI routes: require session cookie ---
  if (pathname.startsWith("/admin")) {
    if (!sessionToken) {
      const redirectUrl = new URL("/admin", request.url);
      redirectUrl.searchParams.set("unauthorized", "1");
      redirectUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
  }

  // --- Admin API routes: require session cookie ---
  if (pathname.startsWith("/api/admin")) {
    if (!sessionToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  // --- Chat + Analyse API routes: CORS, rate limiting ---
  if (pathname.startsWith("/api/chat") || pathname.startsWith("/api/analyse")) {
    // Reject cross-origin POSTs (only allow same-origin or configured base URL)
    if (request.method === "POST") {
      const allowedOrigin = getRequestOrigin(request);
      const origin = request.headers.get("Origin");
      if (origin) {
        try {
          const requestOrigin = new URL(origin).origin;
          if (requestOrigin !== allowedOrigin) {
            return NextResponse.json(
              { error: "Forbidden" },
              { status: 403 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: "Forbidden" },
            { status: 403 }
          );
        }
      }

      // Rate limit by IP (skip when admin is logged in, e.g. for testing)
      if (!sessionToken) {
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
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/chat/:path*", "/api/analyse/:path*"],
};
