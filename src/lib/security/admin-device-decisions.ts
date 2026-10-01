import { ObjectId, type Db } from "mongodb";
import { SECURITY_COLLECTIONS, type DeviceDoc } from "@/lib/security/collections";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { verifyAdminStepUp } from "@/lib/security/admin-step-up";
import {
  classifyUndecidable,
  rejectPendingDevice,
  trustPendingDevice,
  type DecisionOutcome,
} from "@/lib/security/device-verification";
import { isPendingExpired } from "@/lib/security/device-registry";
import { recordAdminAction } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import { getDeviceVerifier } from "@/lib/security/verifier";

/**
 * Admin approve/reject of a pending device.
 *
 * Order: step-up → target check → audit record → atomic transition.
 * The audit row is written BEFORE the state changes, so no device is ever
 * trusted or rejected without one (if the audit write fails, nothing
 * happens). An audit row whose decision then lost a race is harmless; the
 * device's `decisionActionId` names the record that actually took effect.
 */

export type AdminDecision = "APPROVE" | "REJECT";

export type AdminDecisionRequest = {
  adminId: string;
  deviceId: unknown;
  /** The customer the admin believes owns the device. Must match. */
  userId: unknown;
  password: unknown;
  reason: unknown;
  ip?: string | null;
  requestId?: string | null;
  now?: Date;
};

export type AdminDecisionResult =
  | { ok: true; outcome: DecisionOutcome }
  | { ok: false; status: 400 | 401 | 404 | 409 | 429; error: string };

const REASON_MAX = 300;

function cleanReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return value && value.length <= REASON_MAX ? value : null;
}

const STEP_UP_ERRORS = {
  400: "Enter your password to confirm this action.",
  401: "Password confirmation failed.",
  429: "Too many failed confirmations. Try again in 15 minutes.",
} as const;

export async function decidePendingDevice(
  db: Db,
  decision: AdminDecision,
  request: AdminDecisionRequest,
  config: SecurityConfig = getSecurityConfig(),
): Promise<AdminDecisionResult> {
  const now = request.now ?? new Date();
  const deviceId = parseObjectId(request.deviceId);
  const userId = parseObjectId(request.userId);
  if (!deviceId || !userId) return { ok: false, status: 404, error: "Not found" };

  const reason =
    cleanReason(request.reason) ?? (decision === "APPROVE" ? "Approved by administrator" : null);
  if (!reason) {
    return { ok: false, status: 400, error: "A reason (up to 300 characters) is required." };
  }

  const action = decision === "APPROVE" ? "DEVICE_APPROVED" : "DEVICE_REJECTED";
  const stepUp = await verifyAdminStepUp(
    db,
    request.adminId,
    request.password,
    { action, ip: request.ip },
    now,
  );
  if (!stepUp.ok) {
    return { ok: false, status: stepUp.status, error: STEP_UP_ERRORS[stepUp.status] };
  }

  // The device must belong to the named customer, and that customer must be a
  // customer account. Another customer's id looks like a missing device.
  const [device, owner] = await Promise.all([
    db.collection<DeviceDoc>(SECURITY_COLLECTIONS.device).findOne({ _id: deviceId, userId }),
    db.collection<{ role?: string }>("User").findOne({ _id: userId }, { projection: { role: 1 } }),
  ]);
  if (!device || owner?.role !== "USER") return { ok: false, status: 404, error: "Not found" };
  if (device.status !== "PENDING_VERIFICATION" || isPendingExpired(device, now, config)) {
    // Idempotent: nothing to decide, and no audit row for a no-op.
    const result = await classifyUndecidable(db, userId, deviceId, now, config);
    return { ok: true, outcome: result.outcome };
  }

  const adminId = new ObjectId(request.adminId);
  const audit = await recordAdminAction(db, {
    adminId,
    action,
    targetUserId: userId,
    reason,
    ip: request.ip,
    requestId: request.requestId,
    metadata: { deviceId: deviceId.toHexString() },
    occurredAt: now,
  });

  const result =
    decision === "APPROVE"
      ? await trustPendingDevice(
          db,
          {
            userId,
            deviceId,
            decidedBy: adminId,
            actionId: audit._id,
            method: getDeviceVerifier(config).method,
            now,
          },
          config,
        )
      : await rejectPendingDevice(
          db,
          { userId, deviceId, decidedBy: adminId, actionId: audit._id, now },
          config,
        );
  return { ok: true, outcome: result.outcome };
}
