import { ObjectId, type Collection, type Db } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type DeviceDoc,
  type DeviceVerificationMethod,
} from "@/lib/security/collections";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { devicePurgeDate, deviceReferenceCode, findDeviceBySecret } from "@/lib/security/device";
import {
  expirePendingDevice,
  expirePendingDevices,
  isPendingExpired,
  pendingDeadline,
  pendingNotExpiredFilter,
  releaseDeviceSlot,
} from "@/lib/security/device-registry";
import { promoteApprovedDeviceSessions } from "@/lib/security/concurrency";
import { recordSecurityEvent } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import { revokeDeviceSessions } from "@/lib/security/session";

/**
 * Pending-device decisions (I3), independent of the verification mechanism.
 *
 * State machine:
 *
 *   PENDING_VERIFICATION ──approve (before deadline)──▶ TRUSTED
 *            │ ├─reject────────────────────────────────▶ REVOKED (ADMIN_REJECTED)
 *            │ ├─customer revokes──────────────────────▶ REVOKED (USER_REVOKED)
 *            │ └─deadline passes (24h)─────────────────▶ EXPIRED
 *
 * Every transition is one conditional atomic update on `status:
 * PENDING_VERIFICATION`, so for concurrent approve / reject / expire exactly
 * one wins and the rest report the state it produced. Approval requires the
 * deadline to be strictly in the future and expiry requires it to have
 * passed, so the two can't both apply. REVOKED and EXPIRED are terminal:
 * nothing moves a device out of them, and a replayed cookie for one gets a
 * brand-new pending device (I2).
 */

function devices(db: Db): Collection<DeviceDoc> {
  return db.collection<DeviceDoc>(SECURITY_COLLECTIONS.device);
}

export type DecisionOutcome =
  | "TRUSTED"
  | "REJECTED"
  | "ALREADY_TRUSTED"
  | "ALREADY_REJECTED"
  | "REVOKED"
  | "EXPIRED"
  | "NOT_FOUND";

export type DecisionResult = { outcome: DecisionOutcome; device: DeviceDoc | null };

export type DecisionInput = {
  userId: unknown;
  deviceId: unknown;
  /** Admin id (or null for a self-service verifier such as future email OTP). */
  decidedBy: ObjectId | null;
  /** Id of the audit record written before the decision. */
  actionId: ObjectId | null;
  now?: Date;
};

/**
 * Why a decision didn't apply (never applies one). Also expires a pending
 * device that is past its deadline.
 */
export async function classifyUndecidable(
  db: Db,
  userId: ObjectId,
  deviceId: ObjectId,
  now: Date = new Date(),
  config: SecurityConfig = getSecurityConfig(),
): Promise<DecisionResult> {
  return classify(db, userId, deviceId, now, config);
}

async function classify(
  db: Db,
  userId: ObjectId,
  deviceId: ObjectId,
  now: Date,
  config: SecurityConfig,
): Promise<DecisionResult> {
  const device = await devices(db).findOne({ _id: deviceId, userId });
  if (!device) return { outcome: "NOT_FOUND", device: null };
  if (device.status === "TRUSTED") return { outcome: "ALREADY_TRUSTED", device };
  if (device.status === "EXPIRED") return { outcome: "EXPIRED", device };
  if (device.status === "REVOKED") {
    return {
      outcome: device.revokedReason === "ADMIN_REJECTED" ? "ALREADY_REJECTED" : "REVOKED",
      device,
    };
  }
  if (isPendingExpired(device, now, config)) {
    await expirePendingDevice(db, device._id, now, config);
    return { outcome: "EXPIRED", device: await devices(db).findOne({ _id: deviceId }) };
  }
  // Still pending: the conditional update lost a race with something that
  // has since been undone. Report NOT_FOUND rather than guess.
  return { outcome: "NOT_FOUND", device };
}

/**
 * Completes verification: PENDING_VERIFICATION → TRUSTED. The only way a
 * device becomes trusted after the one-time enrollment. Ownership is part of
 * the query, so a device id belonging to another customer can't be trusted.
 */
export async function trustPendingDevice(
  db: Db,
  input: DecisionInput & { method: DeviceVerificationMethod },
  config: SecurityConfig = getSecurityConfig(),
): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  const userId = parseObjectId(input.userId);
  const deviceId = parseObjectId(input.deviceId);
  if (!userId || !deviceId) return { outcome: "NOT_FOUND", device: null };

  const device = await devices(db).findOneAndUpdate(
    {
      _id: deviceId,
      userId,
      status: "PENDING_VERIFICATION",
      ...pendingNotExpiredFilter(now, config),
    },
    {
      $set: {
        status: "TRUSTED",
        verifiedAt: now,
        verificationMethod: input.method,
        pendingExpiresAt: null,
        decidedBy: input.decidedBy,
        decisionActionId: input.actionId,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!device) return classify(db, userId, deviceId, now, config);

  await recordSecurityEvent(db, {
    type: "DEVICE_VERIFIED",
    actorType: input.decidedBy ? "ADMIN" : "USER",
    actorId: input.decidedBy,
    userId,
    deviceId,
    reasonCodes: [input.method],
  });
  // I4: the device's waiting session now counts toward the session limit
  // (NEWEST_WINS), as if the customer had just logged in on it.
  await promoteApprovedDeviceSessions(db, userId, deviceId, config, now);
  return { outcome: "TRUSTED", device };
}

/**
 * PENDING_VERIFICATION → REVOKED (ADMIN_REJECTED): frees the slot and ends
 * the device's sessions. A request already past its deadline is expired
 * instead (same safe end state, no trust).
 */
export async function rejectPendingDevice(
  db: Db,
  input: DecisionInput,
  config: SecurityConfig = getSecurityConfig(),
): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  const userId = parseObjectId(input.userId);
  const deviceId = parseObjectId(input.deviceId);
  if (!userId || !deviceId) return { outcome: "NOT_FOUND", device: null };

  const device = await devices(db).findOneAndUpdate(
    {
      _id: deviceId,
      userId,
      status: "PENDING_VERIFICATION",
      ...pendingNotExpiredFilter(now, config),
    },
    {
      $set: {
        status: "REVOKED",
        revokedReason: "ADMIN_REJECTED",
        revokedAt: now,
        pendingExpiresAt: null,
        purgeAt: devicePurgeDate(now),
        decidedBy: input.decidedBy,
        decisionActionId: input.actionId,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!device) return classify(db, userId, deviceId, now, config);

  await releaseDeviceSlot(db, userId, now);
  const sessionsRevoked = await revokeDeviceSessions(db, userId, deviceId, "DEVICE_REVOKED", now);
  await recordSecurityEvent(db, {
    type: "DEVICE_REJECTED",
    actorType: input.decidedBy ? "ADMIN" : "SYSTEM",
    actorId: input.decidedBy,
    userId,
    deviceId,
    reasonCodes: ["ADMIN_REJECTED"],
    metadata: { sessionsRevoked },
  });
  return { outcome: "REJECTED", device };
}

export type PendingDeviceView = {
  id: string;
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  referenceCode: string;
  platform: string | null;
  browserFamily: string | null;
  requestedAt: string;
  expiresAt: string;
};

/**
 * Admin queue: pending requests that haven't expired, oldest first. Overdue
 * requests are expired first so they never appear as approvable.
 */
export async function listPendingDevices(
  db: Db,
  now: Date = new Date(),
  config: SecurityConfig = getSecurityConfig(),
  limit = 100,
): Promise<PendingDeviceView[]> {
  await expirePendingDevices(db, now, config, { limit: 500 });
  const rows = await devices(db)
    .find({ status: "PENDING_VERIFICATION", ...pendingNotExpiredFilter(now, config) })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  const userIds = [...new Set(rows.map((row) => row.userId.toHexString()))].map(
    (id) => new ObjectId(id),
  );
  const users = userIds.length
    ? await db
        .collection<{ _id: ObjectId; name?: string; email?: string; role?: string }>("User")
        .find({ _id: { $in: userIds }, role: "USER" }, { projection: { name: 1, email: 1 } })
        .toArray()
    : [];
  const byId = new Map(users.map((user) => [user._id.toHexString(), user]));
  return rows
    .filter((row) => byId.has(row.userId.toHexString()))
    .map((row) => {
      const user = byId.get(row.userId.toHexString());
      return {
        id: row._id.toHexString(),
        userId: row.userId.toHexString(),
        customerName: user?.name ?? null,
        customerEmail: user?.email ?? null,
        referenceCode: deviceReferenceCode(row._id),
        platform: row.platform,
        browserFamily: row.browserFamily,
        requestedAt: row.createdAt.toISOString(),
        expiresAt: pendingDeadline(row, config).toISOString(),
      };
    });
}

export type CustomerDeviceState =
  | { state: "PENDING"; referenceCode: string; expiresAt: string }
  | { state: "EXPIRED" | "REJECTED" | "REVOKED" | "TRUSTED" | "UNKNOWN" };

/** What the customer's current browser should be told (waiting-for-approval screen). */
export async function customerDeviceState(
  db: Db,
  userId: string,
  deviceCookie: string | null | undefined,
  now: Date = new Date(),
  config: SecurityConfig = getSecurityConfig(),
): Promise<CustomerDeviceState> {
  const owner = parseObjectId(userId);
  const device = owner ? await findDeviceBySecret(db, deviceCookie) : null;
  if (!device || !owner || !device.userId.equals(owner)) return { state: "UNKNOWN" };
  if (device.status === "TRUSTED") return { state: "TRUSTED" };
  if (device.status === "EXPIRED" || isPendingExpired(device, now, config)) {
    return { state: "EXPIRED" };
  }
  if (device.status === "REVOKED") {
    return { state: device.revokedReason === "ADMIN_REJECTED" ? "REJECTED" : "REVOKED" };
  }
  return {
    state: "PENDING",
    referenceCode: deviceReferenceCode(device._id),
    expiresAt: pendingDeadline(device, config).toISOString(),
  };
}
