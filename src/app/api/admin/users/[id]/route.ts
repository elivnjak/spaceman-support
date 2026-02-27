import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  getSessionFromRequest,
  hashPassword,
  isAdminRole,
  normalizeAdminUiRole,
  requireAdminAuth,
} from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";

type RouteParams = { params: Promise<{ id: string }> };

async function PATCHHandler(request: Request, { params }: RouteParams) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "User id required" }, { status: 400 });
  }

  let body: { email?: string; password?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: { email?: string; passwordHash?: string; role?: string } = {};
  if (body.email !== undefined) {
    updates.email = (body.email as string).trim().toLowerCase();
    if (!updates.email) {
      return NextResponse.json({ error: "email cannot be empty" }, { status: 400 });
    }
  }
  if (body.password !== undefined && body.password !== "") {
    updates.passwordHash = await hashPassword(body.password as string);
  }
  if (body.role !== undefined) {
    const role = normalizeAdminUiRole(body.role);
    if (!role) {
      return NextResponse.json(
        { error: "role must be 'admin' or 'editor'" },
        { status: 400 }
      );
    }
    updates.role = role;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt });
    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
    }
    throw err;
  }
}

async function DELETEHandler(request: Request, { params }: RouteParams) {
  const session = await getSessionFromRequest(request);
  if (!session || !isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "User id required" }, { status: 400 });
  }

  if (session.user.id === id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 403 }
    );
  }

  const [deleted] = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!deleted) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiRouteErrorLogging("/api/admin/users/[id]", PATCHHandler);

export const DELETE = withApiRouteErrorLogging("/api/admin/users/[id]", DELETEHandler);
