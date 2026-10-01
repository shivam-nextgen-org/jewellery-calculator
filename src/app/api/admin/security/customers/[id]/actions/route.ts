import { NextResponse } from "next/server";
import {
  beginCenterRequest,
  CenterApiError,
  centerApiFail,
  clientIp,
} from "@/lib/security/admin-security-center-api";
import { performAdminSecurityAction } from "@/lib/security/admin-security-center";
import { runAfterResponse } from "@/lib/security/background";
import { evaluateCustomerRiskSafely } from "@/lib/security/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/security/customers/:id/actions
 * Body: { action, password, reason, ...action fields }
 * Every action re-checks the admin, requires password step-up and writes the
 * audit record before changing anything.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, db } = await beginCenterRequest();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CenterApiError("Invalid request", 400);
    }
    const { action, ...fields } = body;
    const result = await performAdminSecurityAction(db, {
      adminId: admin.id,
      userId: id,
      action,
      body: fields,
      ip: clientIp(request),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (action === "DEVICE_REJECT" && result.applied) {
      runAfterResponse(() => evaluateCustomerRiskSafely(db, id));
    }
    return NextResponse.json({ outcome: result.outcome, applied: result.applied });
  } catch (error) {
    return centerApiFail(error);
  }
}
