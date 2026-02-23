import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
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

  let userRows: User[];
  try {
    userRows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json(
        { error: "Database not set up. Run migrations and seed (e.g. npm run railway:setup:prod)." },
        { status: 503 }
      );
    }
    throw err;
  }
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
