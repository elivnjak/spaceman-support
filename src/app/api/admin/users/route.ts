import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { EDITOR_ROLE, hashPassword, normalizeAdminUiRole, requireAdminAuth } from "@/lib/auth";
import { withApiRouteErrorLogging } from "@/lib/error-logs";
import { z } from "zod";

const createUserSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12, "password must be at least 12 characters"),
  role: z.string().optional(),
});

async function GETHandler(request: Request) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const list = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
  }).from(users);
  return NextResponse.json(list);
}

async function POSTHandler(request: Request) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  let body: z.infer<typeof createUserSchema>;
  try {
    body = createUserSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid request body. email must be valid and password must be at least 12 characters.",
      },
      { status: 400 }
    );
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const role = body.role === undefined ? EDITOR_ROLE : normalizeAdminUiRole(body.role);

  if (!role) {
    return NextResponse.json(
      { error: "role must be 'admin' or 'editor'" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);
  try {
    const [inserted] = await db
      .insert(users)
      .values({ email, passwordHash, role })
      .returning({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt });
    return NextResponse.json(inserted);
  } catch (err: unknown) {
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
    }
    throw err;
  }
}

export const GET = withApiRouteErrorLogging("/api/admin/users", GETHandler);

export const POST = withApiRouteErrorLogging("/api/admin/users", POSTHandler);
