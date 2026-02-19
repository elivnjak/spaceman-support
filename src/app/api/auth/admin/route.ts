import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const requiredToken = process.env.ADMIN_API_KEY?.trim();
  if (!requiredToken) {
    return NextResponse.json({ error: "Admin auth not configured" }, { status: 503 });
  }

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provided = (body.key ?? "").trim();
  if (!provided || provided !== requiredToken) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_api_key", requiredToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
