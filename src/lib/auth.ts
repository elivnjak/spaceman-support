import { NextResponse } from "next/server";

/**
 * Validates the admin API key from the Authorization header.
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export function requireAdminAuth(request: Request): NextResponse | null {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    // If no key is configured, allow access (dev mode)
    return null;
  }
  const header = request.headers.get("Authorization");
  if (!header) {
    return NextResponse.json(
      { error: "Authorization header required" },
      { status: 401 }
    );
  }
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token !== adminKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return null;
}

/**
 * Validates the chat API key from the Authorization header.
 * Returns null if valid, or a 401 NextResponse if invalid.
 */
export function requireChatAuth(request: Request): NextResponse | null {
  const chatKey = process.env.CHAT_API_KEY;
  if (!chatKey) {
    return null;
  }
  const header = request.headers.get("Authorization");
  if (!header) {
    return NextResponse.json(
      { error: "Authorization header required" },
      { status: 401 }
    );
  }
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token !== chatKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  return null;
}
