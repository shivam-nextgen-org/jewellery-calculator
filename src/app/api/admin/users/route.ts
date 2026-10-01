import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth/session";
import {
  createAppUser,
  deleteAppUser,
  listAppUsers,
  setUserActive,
  updateAppUser,
} from "@/lib/auth/users";

function fail(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message =
    error instanceof Error ? error.message : "Request failed";
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  try {
    await requireAdmin();
    const users = await listAppUsers();
    return NextResponse.json(users);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };
    const user = await createAppUser({
      name: body.name ?? "",
      email: body.email ?? "",
      password: body.password ?? "",
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as {
      id?: string;
      isActive?: boolean;
      name?: string;
    };
    if (!body.id) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    // Two shapes share this endpoint: a name edit, or an active toggle.
    if (typeof body.name === "string") {
      const user = await updateAppUser(body.id, { name: body.name });
      return NextResponse.json(user);
    }
    if (typeof body.isActive === "boolean") {
      const user = await setUserActive(body.id, body.isActive);
      return NextResponse.json(user);
    }
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => null)) as {
      id?: string;
    } | null;
    if (!body?.id) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const result = await deleteAppUser(body.id);
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}
