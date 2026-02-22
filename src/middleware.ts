import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
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
