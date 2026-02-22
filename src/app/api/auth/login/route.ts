import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  createSession,
  getSessionCookieName,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 }
    );
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const user = userRows[0];
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
}
