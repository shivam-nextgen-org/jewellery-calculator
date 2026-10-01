import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { AuthError, requireAdmin, type SessionUser } from "@/lib/auth/session";
import { runAfterResponse } from "@/lib/security/background";
import { getSecurityConfig } from "@/lib/security/config";
import { evaluateCustomerRiskSafely } from "@/lib/security/risk";
import {
  decidePendingDevice,
  type AdminDecision,
} from "@/lib/security/admin-device-decisions";

/** Shared plumbing for /api/admin/security/devices/*. */

export class AdminDeviceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function adminDeviceApiFail(error: unknown) {
  if (error instanceof AuthError || error instanceof AdminDeviceApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

export async function beginAdminDeviceRequest(): Promise<{ admin: SessionUser; db: Db }> {
  // Hidden until new-device verification is switched on.
  if (getSecurityConfig().flags.deviceVerification !== "on") {
    throw new AdminDeviceApiError("Not found", 404);
  }
  const admin = await requireAdmin();
  const { getDb } = await import("@/lib/mongo");
  return { admin, db: await getDb() };
}

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** POST handler body for approve/reject. Body: { userId, password, reason? } */
export async function handleAdminDecision(
  decision: AdminDecision,
  request: Request,
  params: Promise<{ id: string }>,
) {
  try {
    const { admin, db } = await beginAdminDeviceRequest();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      userId?: unknown;
      password?: unknown;
      reason?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      throw new AdminDeviceApiError("Invalid request", 400);
    }
    const result = await decidePendingDevice(db, decision, {
      adminId: admin.id,
      deviceId: id,
      userId: body.userId,
      password: body.password,
      reason: body.reason,
      ip: clientIp(request),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const applied = result.outcome === "TRUSTED" || result.outcome === "REJECTED";
    if (result.outcome === "REJECTED") {
      // I5: rejected devices are a risk signal for the customer.
      const target = body.userId;
      runAfterResponse(() => evaluateCustomerRiskSafely(db, target));
    }
    return NextResponse.json(
      { outcome: result.outcome, applied },
      // A request that can no longer be decided is a conflict, not a success.
      { status: applied || result.outcome.startsWith("ALREADY_") ? 200 : 409 },
    );
  } catch (error) {
    return adminDeviceApiFail(error);
  }
}
