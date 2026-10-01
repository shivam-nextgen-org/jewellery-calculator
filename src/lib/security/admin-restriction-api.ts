import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { AuthError, requireAdmin, type SessionUser } from "@/lib/auth/session";
import { liftRestrictionAsAdmin } from "@/lib/security/admin-restrictions";
import { getSecurityConfig } from "@/lib/security/config";

/** Shared plumbing for /api/admin/security/restrictions/*. */

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function restrictionApiFail(error: unknown) {
  if (error instanceof AuthError || error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

export async function beginRestrictionRequest(): Promise<{ admin: SessionUser; db: Db }> {
  // Hidden until restrictions are switched on.
  if (getSecurityConfig().flags.restrictions !== "on") throw new ApiError("Not found", 404);
  const admin = await requireAdmin();
  const { getDb } = await import("@/lib/mongo");
  return { admin, db: await getDb() };
}

/** POST handler for lift. Body: { userId, password, reason } */
export async function handleLift(request: Request, params: Promise<{ id: string }>) {
  try {
    const { admin, db } = await beginRestrictionRequest();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      userId?: unknown;
      password?: unknown;
      reason?: unknown;
    } | null;
    if (!body || typeof body !== "object") throw new ApiError("Invalid request", 400);
    const result = await liftRestrictionAsAdmin(db, {
      adminId: admin.id,
      restrictionId: id,
      userId: body.userId,
      password: body.password,
      reason: body.reason,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ outcome: result.outcome, applied: result.outcome === "REMOVED" });
  } catch (error) {
    return restrictionApiFail(error);
  }
}
