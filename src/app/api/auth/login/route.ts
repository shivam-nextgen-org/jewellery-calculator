import { NextResponse } from "next/server";
import { getDb, idOf, type ObjectId } from "@/lib/mongo";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { consumeLoginAttempt } from "@/lib/auth/rate-limit";

type UserRow = {
  _id: ObjectId;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "USER";
  passwordHash: string;
  isActive: boolean;
};

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (!consumeLoginAttempt(ip)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    remember?: boolean;
  } | null;

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const remember = body?.remember === true;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  let user: UserRow | null;
  try {
    const db = await getDb();
    user = (await db
      .collection("User")
      .findOne(
        { email },
        {
          projection: {
            email: 1,
            name: 1,
            role: 1,
            passwordHash: 1,
            isActive: 1,
          },
        },
      )) as UserRow | null;
  } catch {
    return NextResponse.json(
      { error: "Cannot reach the database. Please try again." },
      { status: 503 },
    );
  }

  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }
  if (!user.isActive) {
    return NextResponse.json(
      { error: "This account is disabled." },
      { status: 403 },
    );
  }

  await createSession(
    {
      id: idOf(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
    },
    remember,
  );

  return NextResponse.json({
    role: user.role,
    name: user.name,
    redirect: user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard",
  });
}
