import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="admin"' },
  });
}

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
}

function isPublicAdminReadPath(pathname: string): boolean {
  return pathname === "/admin" || pathname === "/admin/";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isAdminPath(pathname) || isPublicAdminReadPath(pathname)) {
    return NextResponse.next();
  }

  const requiredToken = process.env.ADMIN_API_KEY?.trim();
  if (!requiredToken) {
    // Fail closed in production if ADMIN_API_KEY is missing.
    if (process.env.NODE_ENV === "production") return unauthorized();
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const cookieToken = request.cookies.get("admin_api_key")?.value?.trim() ?? "";
  const provided = bearerToken || cookieToken;

  if (!provided || provided !== requiredToken) {
    // Redirect to public admin page so user can enter key (cookie will be set via /api/auth/admin).
    const loginUrl = new URL("/admin", request.url);
    loginUrl.searchParams.set("unauthorized", "1");
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

