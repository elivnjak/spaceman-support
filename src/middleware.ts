import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Origin inferred from incoming request (works behind proxies like Railway). */
function getRequestOrigin(request: NextRequest): string {
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

function getAllowedOrigins(request: NextRequest): Set<string> {
  const allowedOrigins = new Set<string>();
  allowedOrigins.add(getRequestOrigin(request));

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (baseUrl) {
    try {
      allowedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Ignore malformed env value; request origin remains allowed.
    }
  }

  return allowedOrigins;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken =
    request.cookies.get("__Host-session_token")?.value?.trim() ?? "";

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

  // --- Chat API routes: CORS, rate limiting ---
  if (pathname.startsWith("/api/chat")) {
    // Reject cross-origin POSTs (only allow same-origin or configured base URL)
    if (request.method === "POST") {
      const allowedOrigins = getAllowedOrigins(request);
      const origin = request.headers.get("Origin");
      if (origin) {
        try {
          const requestOrigin = new URL(origin).origin;
          if (!allowedOrigins.has(requestOrigin)) {
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
        const limit = RATE_LIMITS.chatPerIp;
        const result = await checkRateLimit(
          `ip:${pathname}:${ip}`,
          limit.maxRequests,
          limit.windowMs
        );
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
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/chat/:path*"],
};
