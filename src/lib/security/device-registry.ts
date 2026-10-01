import { MongoServerError, ObjectId, type Collection, type Db } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type DeviceDoc,
  type SecurityAccountDoc,
} from "@/lib/security/collections";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import {
  devicePurgeDate,
  deviceReferenceCode,
  generateDeviceSecret,
  hashDeviceSecret,
  parseDeviceCookie,
  TERMINAL_DEVICE_STATUSES,
} from "@/lib/security/device";
import { recordSecurityEvent } from "@/lib/security/events";
import { parseObjectId, requireObjectId } from "@/lib/security/ids";
import { revokeDeviceSessions } from "@/lib/security/session";

/**
 * Device registration and self-service lifecycle (I2).
 *
 * Invariants:
 * - Identity is only the server-minted secret in `atelier_device`. User agent
 *   is stored as a coarse, descriptive label and never used for matching.
 * - `SecurityAccount.deviceSlotsUsed` counts devices holding a slot
 *   (PENDING_VERIFICATION or TRUSTED). It is claimed with a conditional atomic
 *   update, so concurrent registrations can never exceed the limit.
 * - The first device is auto-trusted exactly once per customer
 *   (`enrolledAt`). Revoking devices never resets it; every later device is
 *   PENDING_VERIFICATION until the I3 verification flow approves it.
 * - A revoked/expired device is never revived by presenting its old cookie.
 */

const ACTIVE_STATUSES = ["PENDING_VERIFICATION", "TRUSTED"] as const;

function devices(db: Db): Collection<DeviceDoc> {
  return db.collection<DeviceDoc>(SECURITY_COLLECTIONS.device);
}

function accounts(db: Db): Collection<SecurityAccountDoc> {
  return db.collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account);
}

/** Coarse, descriptive only. Never used as identity. */
export function describeUserAgent(userAgent: string | null | undefined): {
  platform: string | null;
  browserFamily: string | null;
} {
  const ua = userAgent?.slice(0, 512) ?? "";
  if (!ua) return { platform: null, browserFamily: null };
  const platform = /iPhone|iPad|iPod/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
      ? "Android"
      : /CrOS/i.test(ua)
        ? "ChromeOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/i.test(ua)
            ? "macOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Other";
  const browserFamily = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/i.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Other";
  return { platform, browserFamily };
}

async function ensureAccount(db: Db, userId: ObjectId, now: Date) {
  try {
    await accounts(db).updateOne(
      { _id: userId },
      {
        $setOnInsert: {
          deviceSlotsUsed: 0,
          enrolledAt: null,
          enrolledDeviceId: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Two concurrent first logins can race on the upsert; the document exists.
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
  }
}

type SlotClaim = "ENROLLED" | "SLOT" | null;

/** Atomically claims a device slot, preferring the one-time enrollment. */
async function claimSlot(
  db: Db,
  userId: ObjectId,
  limit: number,
  now: Date,
): Promise<SlotClaim> {
  // I7: a per-customer override on the same document wins over the default.
  // Comparing inside the update filter keeps the claim atomic even while an
  // admin changes the limit.
  const underLimit = {
    $expr: { $lt: ["$deviceSlotsUsed", { $ifNull: ["$deviceLimit", limit] }] },
  };
  const enrolled = await accounts(db).findOneAndUpdate(
    { _id: userId, enrolledAt: null, ...underLimit },
    { $set: { enrolledAt: now, updatedAt: now }, $inc: { deviceSlotsUsed: 1 } },
  );
  if (enrolled) return "ENROLLED";
  const slot = await accounts(db).findOneAndUpdate(
    { _id: userId, ...underLimit },
    { $set: { updatedAt: now }, $inc: { deviceSlotsUsed: 1 } },
  );
  return slot ? "SLOT" : null;
}

async function releaseSlot(db: Db, userId: ObjectId, now: Date) {
  await accounts(db).updateOne(
    { _id: userId, deviceSlotsUsed: { $gt: 0 } },
    { $inc: { deviceSlotsUsed: -1 }, $set: { updatedAt: now } },
  );
}

/** Exported for the verification module: frees one slot. */
export async function releaseDeviceSlot(db: Db, userId: ObjectId, now: Date) {
  await releaseSlot(db, userId, now);
}

// ---------------------------------------------------------------------------
// Pending-device expiry (I3). Kept here so registration can free expired
// slots before claiming one, without an import cycle.
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

function pendingTtlMs(config: SecurityConfig) {
  return config.device.pendingTtlHours * HOUR_MS;
}

/** Deadline of a pending device. Devices created before I3 use createdAt + TTL. */
export function pendingDeadline(
  device: Pick<DeviceDoc, "createdAt" | "pendingExpiresAt">,
  config: SecurityConfig = getSecurityConfig(),
): Date {
  return device.pendingExpiresAt ?? new Date(device.createdAt.getTime() + pendingTtlMs(config));
}

export function isPendingExpired(
  device: Pick<DeviceDoc, "status" | "createdAt" | "pendingExpiresAt">,
  now: Date,
  config: SecurityConfig = getSecurityConfig(),
): boolean {
  return (
    device.status === "PENDING_VERIFICATION" &&
    pendingDeadline(device, config).getTime() <= now.getTime()
  );
}

/** Query fragment: a pending device whose deadline is still in the future. */
export function pendingNotExpiredFilter(now: Date, config: SecurityConfig) {
  return {
    $or: [
      { pendingExpiresAt: { $gt: now } },
      { pendingExpiresAt: null, createdAt: { $gt: new Date(now.getTime() - pendingTtlMs(config)) } },
    ],
  };
}

function pendingExpiredFilter(now: Date, config: SecurityConfig) {
  return {
    $or: [
      { pendingExpiresAt: { $lte: now } },
      { pendingExpiresAt: null, createdAt: { $lte: new Date(now.getTime() - pendingTtlMs(config)) } },
    ],
  };
}

/**
 * Atomically moves one pending device past its deadline to EXPIRED, frees its
 * slot and revokes its sessions. Only the call that flips the status does the
 * side effects, so concurrent expiry/approval/rejection can't double-count.
 * Returns true if this call expired it.
 */
export async function expirePendingDevice(
  db: Db,
  deviceId: ObjectId,
  now: Date = new Date(),
  config: SecurityConfig = getSecurityConfig(),
): Promise<boolean> {
  const expired = await devices(db).findOneAndUpdate(
    { _id: deviceId, status: "PENDING_VERIFICATION", ...pendingExpiredFilter(now, config) },
    {
      $set: {
        status: "EXPIRED",
        pendingExpiresAt: null,
        purgeAt: devicePurgeDate(now),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!expired) return false;
  await releaseSlot(db, expired.userId, now);
  await revokeDeviceSessions(db, expired.userId, expired._id, "DEVICE_REVOKED", now);
  await recordSecurityEvent(db, {
    type: "DEVICE_EXPIRED",
    actorType: "SYSTEM",
    userId: expired.userId,
    deviceId: expired._id,
    reasonCodes: ["PENDING_APPROVAL_EXPIRED"],
  });
  return true;
}

/** Expires overdue pending devices, for one customer or globally (bounded). */
export async function expirePendingDevices(
  db: Db,
  now: Date = new Date(),
  config: SecurityConfig = getSecurityConfig(),
  scope: { userId?: ObjectId; limit?: number } = {},
): Promise<number> {
  const candidates = await devices(db)
    .find(
      {
        ...(scope.userId ? { userId: scope.userId } : {}),
        status: "PENDING_VERIFICATION",
        ...pendingExpiredFilter(now, config),
      },
      { projection: { _id: 1 } },
    )
    .sort({ createdAt: 1 })
    .limit(scope.limit ?? 200)
    .toArray();
  let count = 0;
  for (const { _id } of candidates) {
    if (await expirePendingDevice(db, _id, now, config)) count += 1;
  }
  return count;
}

export type CookieRejection = "MALFORMED" | "UNKNOWN" | "OTHER_USER" | "REVOKED" | "EXPIRED";

export type DeviceRegistration =
  | { outcome: "EXISTING"; device: DeviceDoc; cookieRejected: null }
  | {
      outcome: "CREATED";
      device: DeviceDoc;
      /** Raw secret for the cookie. Returned once; never stored or logged. */
      secret: string;
      enrolled: boolean;
      cookieRejected: CookieRejection | null;
    }
  | { outcome: "LIMIT_REACHED"; cookieRejected: CookieRejection | null };

export type RegisterDeviceInput = {
  userId: string | ObjectId;
  deviceCookie?: string | null;
  userAgent?: string | null;
  now?: Date;
};

/**
 * Resolves the presented device cookie for this customer, or registers a new
 * device. Repeating the call with the same valid cookie never creates a
 * duplicate.
 */
export async function registerDevice(
  db: Db,
  input: RegisterDeviceInput,
  config: SecurityConfig = getSecurityConfig(),
): Promise<DeviceRegistration> {
  const now = input.now ?? new Date();
  const userId = requireObjectId(input.userId, "userId");

  let cookieRejected: CookieRejection | null = null;
  const presented = input.deviceCookie ?? null;
  if (presented) {
    const secret = parseDeviceCookie(presented);
    if (!secret) {
      cookieRejected = "MALFORMED";
    } else {
      const device = await devices(db).findOne({ secretHash: hashDeviceSecret(secret) });
      if (!device) cookieRejected = "UNKNOWN";
      else if (!device.userId.equals(userId)) cookieRejected = "OTHER_USER";
      else if (device.status === "EXPIRED") cookieRejected = "EXPIRED";
      else if (TERMINAL_DEVICE_STATUSES.includes(device.status)) cookieRejected = "REVOKED";
      else if (isPendingExpired(device, now, config)) {
        // Logging in again never extends or approves a pending request.
        await expirePendingDevice(db, device._id, now, config);
        cookieRejected = "EXPIRED";
      } else {
        await devices(db).updateOne(
          { _id: device._id },
          { $set: { lastSeenAt: now, updatedAt: now } },
        );
        return { outcome: "EXISTING", device: { ...device, lastSeenAt: now }, cookieRejected: null };
      }
    }
  }

  await ensureAccount(db, userId, now);
  // Overdue pending requests shouldn't hold slots.
  await expirePendingDevices(db, now, config, { userId, limit: 20 });
  const claim = await claimSlot(db, userId, config.limits.deviceLimit, now);
  if (!claim) return { outcome: "LIMIT_REACHED", cookieRejected };

  const enrolled = claim === "ENROLLED";
  const secret = generateDeviceSecret();
  const { platform, browserFamily } = describeUserAgent(input.userAgent);
  const device: DeviceDoc = {
    _id: new ObjectId(),
    userId,
    secretHash: hashDeviceSecret(secret),
    status: enrolled ? "TRUSTED" : "PENDING_VERIFICATION",
    label: null,
    platform,
    browserFamily,
    firstSeenAt: now,
    lastSeenAt: now,
    verifiedAt: enrolled ? now : null,
    revokedAt: null,
    purgeAt: null,
    createdAt: now,
    updatedAt: now,
    pendingExpiresAt: enrolled ? null : new Date(now.getTime() + pendingTtlMs(config)),
    revokedReason: null,
    verificationMethod: enrolled ? "ENROLLMENT" : null,
    decidedBy: null,
    decisionActionId: null,
  };

  try {
    await devices(db).insertOne(device);
  } catch (error) {
    // Give the slot (and, if claimed, the enrollment) back.
    await accounts(db).updateOne(
      { _id: userId, deviceSlotsUsed: { $gt: 0 } },
      {
        $inc: { deviceSlotsUsed: -1 },
        $set: enrolled ? { enrolledAt: null, updatedAt: now } : { updatedAt: now },
      },
    );
    throw error;
  }
  if (enrolled) {
    await accounts(db).updateOne(
      { _id: userId },
      { $set: { enrolledDeviceId: device._id, updatedAt: now } },
    );
  }
  return { outcome: "CREATED", device, secret, enrolled, cookieRejected };
}

export type DeviceView = {
  id: string;
  label: string | null;
  platform: string | null;
  browserFamily: string | null;
  status: "TRUSTED" | "PENDING_VERIFICATION";
  firstSeenAt: string;
  lastSeenAt: string;
  current: boolean;
  /** Pending devices only: code to quote to the admin, and the 24h deadline. */
  referenceCode?: string;
  pendingExpiresAt?: string;
};

/** Public shape: no secret hash, no user id, no purge metadata. */
export function toDeviceView(
  device: DeviceDoc,
  currentDeviceId?: ObjectId | null,
  config: SecurityConfig = getSecurityConfig(),
): DeviceView {
  const pending =
    device.status === "PENDING_VERIFICATION"
      ? {
          referenceCode: deviceReferenceCode(device._id),
          pendingExpiresAt: pendingDeadline(device, config).toISOString(),
        }
      : {};
  return {
    ...pending,
    id: device._id.toHexString(),
    label: device.label,
    platform: device.platform,
    browserFamily: device.browserFamily,
    status: device.status === "TRUSTED" ? "TRUSTED" : "PENDING_VERIFICATION",
    firstSeenAt: device.firstSeenAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    current: Boolean(currentDeviceId && device._id.equals(currentDeviceId)),
  };
}

/**
 * A customer's usable devices (trusted and pending). Revoked and expired
 * devices are hidden; overdue pending requests are expired first.
 */
export async function listDevices(
  db: Db,
  userId: string | ObjectId,
  now: Date = new Date(),
  config: SecurityConfig = getSecurityConfig(),
): Promise<DeviceDoc[]> {
  await expirePendingDevices(db, now, config, { userId: requireObjectId(userId, "userId"), limit: 50 });
  return devices(db)
    .find({ userId: requireObjectId(userId, "userId"), status: { $in: [...ACTIVE_STATUSES] } })
    .sort({ lastSeenAt: -1 })
    .limit(50)
    .toArray();
}

const LABEL_MAX = 40;

/** Returns a clean label, null to clear it, or undefined if invalid. */
export function normalizeDeviceLabel(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const clean = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length > LABEL_MAX) return undefined;
  return clean;
}

/** Renames one of the customer's own usable devices. Null if not found/owned. */
export async function renameDevice(
  db: Db,
  userId: string | ObjectId,
  deviceId: unknown,
  label: string | null,
  now: Date = new Date(),
): Promise<DeviceDoc | null> {
  const id = parseObjectId(deviceId);
  if (!id) return null;
  return devices(db).findOneAndUpdate(
    { _id: id, userId: requireObjectId(userId, "userId"), status: { $in: [...ACTIVE_STATUSES] } },
    { $set: { label, updatedAt: now } },
    { returnDocument: "after" },
  );
}

export type RevokeResult =
  | { state: "REVOKED"; device: DeviceDoc; sessionsRevoked: number }
  | { state: "ALREADY_REVOKED" }
  | { state: "NOT_FOUND" };

/**
 * Revokes one of the customer's own devices: frees its slot and revokes its
 * sessions. Idempotent and race-safe — only the call that flips the status
 * releases the slot.
 */
export async function revokeDevice(
  db: Db,
  userId: string | ObjectId,
  deviceId: unknown,
  now: Date = new Date(),
  reason: "USER_REVOKED" | "ADMIN_REVOKED" = "USER_REVOKED",
): Promise<RevokeResult> {
  const id = parseObjectId(deviceId);
  if (!id) return { state: "NOT_FOUND" };
  const owner = requireObjectId(userId, "userId");

  const device = await devices(db).findOneAndUpdate(
    { _id: id, userId: owner, status: { $in: [...ACTIVE_STATUSES] } },
    {
      $set: {
        status: "REVOKED",
        revokedReason: reason,
        revokedAt: now,
        pendingExpiresAt: null,
        purgeAt: devicePurgeDate(now),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!device) {
    const exists = await devices(db).findOne({ _id: id, userId: owner }, { projection: { _id: 1 } });
    return exists ? { state: "ALREADY_REVOKED" } : { state: "NOT_FOUND" };
  }
  await releaseSlot(db, owner, now);
  const sessionsRevoked = await revokeDeviceSessions(db, owner, id, "DEVICE_REVOKED", now);
  return { state: "REVOKED", device, sessionsRevoked };
}

/**
 * Admin/repair primitive (for I7): recomputes the slot counter from the
 * devices that actually hold a slot. Needed only if a process died between
 * claiming a slot and inserting the device.
 */
export async function recountDeviceSlots(
  db: Db,
  userId: string | ObjectId,
  now: Date = new Date(),
): Promise<number> {
  const owner = requireObjectId(userId, "userId");
  const used = await devices(db).countDocuments({
    userId: owner,
    status: { $in: [...ACTIVE_STATUSES] },
  });
  await ensureAccount(db, owner, now);
  await accounts(db).updateOne(
    { _id: owner },
    { $set: { deviceSlotsUsed: used, updatedAt: now } },
  );
  return used;
}

/** Removes a customer's device/session/account security records (account deletion). */
export async function deleteSecurityRecordsForUser(db: Db, userId: string | ObjectId) {
  const owner = requireObjectId(userId, "userId");
  await Promise.all([
    devices(db).deleteMany({ userId: owner }),
    db.collection(SECURITY_COLLECTIONS.session).deleteMany({ userId: owner }),
    db.collection(SECURITY_COLLECTIONS.restriction).deleteMany({ userId: owner }),
    accounts(db).deleteOne({ _id: owner }),
  ]);
}
