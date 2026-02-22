import { NextResponse } from "next/server";
import { deleteSession, getSessionCookieName } from "@/lib/auth";

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const target = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(target)) {
      return decodeURIComponent(part.slice(target.length));
    }
  }
  return null;
}

export async function POST(request: Request) {
  const cookieName = getSessionCookieName();
  const token = getCookieValue(request.headers.get("cookie"), cookieName);

  if (token) {
    await deleteSession(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
