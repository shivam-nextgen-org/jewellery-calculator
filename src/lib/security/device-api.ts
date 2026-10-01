import { NextResponse } from "next/server";
import { AuthError, requireCustomerSession, type SessionUser } from "@/lib/auth/session";
import { getSecurityConfig } from "@/lib/security/config";
import { DEVICE_COOKIE, findDeviceBySecret } from "@/lib/security/device";
import type { Db, ObjectId } from "mongodb";

/**
 * Shared plumbing for the self-service device routes. Order matters:
 * feature flag → authentication/authorization → (only then) body parsing.
 */

export class DeviceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function deviceApiFail(error: unknown) {
  if (error instanceof AuthError || error instanceof DeviceApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // No internal details: driver errors can echo documents.
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

export type DeviceApiContext = { user: SessionUser; db: Db };

export async function beginDeviceRequest(): Promise<DeviceApiContext> {
  // Hidden until device tracking is switched on.
  if (getSecurityConfig().flags.deviceTrust === "off") {
    throw new DeviceApiError("Not found", 404);
  }
  const user = await requireCustomerSession();
  const { getDb } = await import("@/lib/mongo");
  return { user, db: await getDb() };
}

/** The caller's current device (from their own cookie), if it belongs to them. */
export async function currentDeviceId(db: Db, user: SessionUser): Promise<ObjectId | null> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const device = await findDeviceBySecret(db, jar.get(DEVICE_COOKIE)?.value);
  return device && device.userId.toHexString() === user.id ? device._id : null;
}
