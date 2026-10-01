import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { AuthError, requireAdmin, type SessionUser } from "@/lib/auth/session";
import { isActiveAdmin } from "@/lib/security/admin-security-center";
import { getSecurityConfig } from "@/lib/security/config";

/**
 * Shared plumbing for /api/admin/security/customers/*.
 * Order: feature flag → admin session (JWT role + authorize()) → live
 * "admin is still enabled" check → only then the handler.
 */

export class CenterApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function centerApiFail(error: unknown) {
  if (error instanceof AuthError || error instanceof CenterApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // No internal details: driver errors can echo documents.
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

export async function beginCenterRequest(): Promise<{ admin: SessionUser; db: Db }> {
  if (getSecurityConfig().flags.adminSecurityCenter !== "on") throw new CenterApiError("Not found", 404);
  const admin = await requireAdmin();
  const { getDb } = await import("@/lib/mongo");
  const db = await getDb();
  if (!(await isActiveAdmin(db, admin.id))) throw new CenterApiError("Forbidden", 403);
  return { admin, db };
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
