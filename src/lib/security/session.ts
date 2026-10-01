import { ObjectId, type Collection, type Db } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type SessionDoc,
  type SessionRevokeReason,
} from "@/lib/security/collections";
import { getSecurityConfig } from "@/lib/security/config";
import {
  generateOpaqueToken,
  isOpaqueToken,
  safeReference,
  sha256Hex,
} from "@/lib/security/crypto";
import { requireObjectId } from "@/lib/security/ids";

/**
 * Server-side sessions (I1 foundation, I2 device binding).
 *
 * The session id handed to a client is an opaque CSPRNG value carried in the
 * `atelier_sid` cookie; only its sha256 is stored, so a database read can't be
 * replayed as a session. Logs and events use `sessionRef()` (ADR-017).
 *
 * Not here yet: concurrent-session enforcement (maxConcurrentSessions /
 * NEWEST_WINS) — that is I4.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function sessions(db: Db): Collection<SessionDoc> {
  return db.collection<SessionDoc>(SECURITY_COLLECTIONS.session);
}

export function hashSessionId(sessionId: string): string {
  return sha256Hex(sessionId);
}

/** Log-safe reference for a raw session id. Never log the id itself. */
export function sessionRef(sessionId: string): string {
  return safeReference(hashSessionId(sessionId));
}

export type CreateSessionInput = {
  userId: string | ObjectId;
  deviceId: string | ObjectId;
  rememberMe?: boolean;
  now?: Date;
  /** I4: concurrency order (see concurrency.ts). */
  generation?: number | null;
  pendingExempt?: boolean;
  generationPending?: boolean;
};

export async function createServerSession(
  db: Db,
  input: CreateSessionInput,
  config = getSecurityConfig(),
): Promise<{ sessionId: string; session: SessionDoc }> {
  const now = input.now ?? new Date();
  const rememberMe = input.rememberMe === true;
  const days = rememberMe
    ? config.sessions.rememberDays
    : config.sessions.defaultDays;
  const sessionId = generateOpaqueToken();
  const session: SessionDoc = {
    _id: new ObjectId(),
    sessionIdHash: hashSessionId(sessionId),
    userId: requireObjectId(input.userId, "userId"),
    deviceId: requireObjectId(input.deviceId, "deviceId"),
    status: "ACTIVE",
    rememberMe,
    createdAt: now,
    lastActivityAt: now,
    expiresAt: new Date(now.getTime() + days * DAY_MS),
    revokedAt: null,
    revokedReason: null,
    generation: input.generation ?? null,
    ...(input.pendingExempt ? { pendingExempt: true } : {}),
    ...(input.generationPending ? { generationPending: true } : {}),
  };
  await sessions(db).insertOne(session);
  return { sessionId, session };
}

export type SessionState =
  | { state: "VALID"; session: SessionDoc }
  | { state: "NOT_FOUND" }
  | { state: "EXPIRED"; session: SessionDoc }
  | { state: "REVOKED"; session: SessionDoc };

/** Pure: classify a stored session at a point in time. */
export function evaluateSession(
  session: SessionDoc | null,
  now: Date = new Date(),
): SessionState {
  if (!session) return { state: "NOT_FOUND" };
  if (session.status !== "ACTIVE" || session.revokedAt) {
    return { state: "REVOKED", session };
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    return { state: "EXPIRED", session };
  }
  return { state: "VALID", session };
}

/**
 * Resolves a presented session id. Malformed ids never reach the DB.
 * Expired sessions are reported as EXPIRED even before the TTL monitor
 * (which runs roughly once a minute) physically removes them.
 */
export async function lookupSession(
  db: Db,
  sessionId: string | null | undefined,
  now: Date = new Date(),
): Promise<SessionState> {
  if (!isOpaqueToken(sessionId)) return { state: "NOT_FOUND" };
  const session = await sessions(db).findOne({
    sessionIdHash: hashSessionId(sessionId),
  });
  return evaluateSession(session, now);
}

/**
 * Revokes one session. Idempotent: an already-revoked session keeps its
 * original revokedAt/reason. Returns true only if this call revoked it.
 */
export async function revokeSession(
  db: Db,
  sessionId: string,
  reason: SessionRevokeReason,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isOpaqueToken(sessionId)) return false;
  const result = await sessions(db).updateOne(
    { sessionIdHash: hashSessionId(sessionId), status: "ACTIVE" },
    { $set: { status: "REVOKED", revokedAt: now, revokedReason: reason } },
  );
  return result.modifiedCount === 1;
}

/** Cookie carrying the opaque session id (Option B: the JWT format is unchanged). */
export const SESSION_ID_COOKIE = "atelier_sid";

export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

/** Same lifetime as the JWT it accompanies. */
export function sessionCookieOptions(
  rememberMe: boolean,
  config = getSecurityConfig(),
): SessionCookieOptions {
  const days = rememberMe
    ? config.sessions.rememberDays
    : config.sessions.defaultDays;
  return {
    httpOnly: true,
    secure: config.device.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: days * 24 * 60 * 60,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Starts a session bound to a device, replacing that device's previous
 * session. Sessions on other devices are untouched here; the cross-device
 * limit (NEWEST_WINS) is applied by startSessionWithConcurrency() in
 * ./concurrency.ts, which wraps this.
 *
 * Race safety: the partial unique index `session_active_per_device_unique`
 * allows only one ACTIVE session per device; a parallel login that loses the
 * race retries once after revoking again. If the device is revoked while the
 * session is being created, the new session is revoked immediately.
 *
 * Returns null if the device is not (or no longer) usable.
 */
export async function startDeviceSession(
  db: Db,
  input: CreateSessionInput,
  config = getSecurityConfig(),
): Promise<{ sessionId: string; session: SessionDoc } | null> {
  const now = input.now ?? new Date();
  const userId = requireObjectId(input.userId, "userId");
  const deviceId = requireObjectId(input.deviceId, "deviceId");
  const deviceCol = db.collection<{ _id: ObjectId; userId: ObjectId; status: string }>(
    SECURITY_COLLECTIONS.device,
  );
  const usable = { _id: deviceId, userId, status: { $in: ["PENDING_VERIFICATION", "TRUSTED"] } };

  if (!(await deviceCol.findOne(usable, { projection: { _id: 1 } }))) return null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await sessions(db).updateMany(
      { deviceId, userId, status: "ACTIVE" },
      { $set: { status: "REVOKED", revokedAt: now, revokedReason: "REPLACED" } },
    );
    let created: { sessionId: string; session: SessionDoc };
    try {
      created = await createServerSession(db, { ...input, userId, deviceId, now }, config);
    } catch (error) {
      if (isDuplicateKey(error) && attempt === 0) continue;
      throw error;
    }
    // Revocation sets the device status before revoking its sessions, so a
    // revoke racing with this insert is always caught here.
    if (!(await deviceCol.findOne(usable, { projection: { _id: 1 } }))) {
      await sessions(db).updateOne(
        { _id: created.session._id, status: "ACTIVE" },
        { $set: { status: "REVOKED", revokedAt: now, revokedReason: "DEVICE_REVOKED" } },
      );
      return null;
    }
    return created;
  }
  return null;
}

/** Throttled lastActivityAt update. Never throws. */
export async function touchSession(
  db: Db,
  session: Pick<SessionDoc, "_id">,
  now: Date = new Date(),
  config = getSecurityConfig(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - config.sessions.activityTouchSeconds * 1000);
  await sessions(db)
    .updateOne(
      { _id: session._id, status: "ACTIVE", lastActivityAt: { $lt: cutoff } },
      { $set: { lastActivityAt: now } },
    )
    .catch(() => undefined);
}

/** Revokes every active session on one device. Returns how many were revoked. */
/**
 * I7 force logout: true if the session was created at or before the
 * customer's `sessionsValidAfter`. Also revokes the row (idempotent).
 */
export async function isEndedByForceLogout(
  db: Db,
  session: SessionDoc,
  now: Date = new Date(),
): Promise<boolean> {
  const account = await db
    .collection<{ _id: ObjectId; sessionsValidAfter?: Date | null }>(SECURITY_COLLECTIONS.account)
    .findOne({ _id: session.userId }, { projection: { sessionsValidAfter: 1 } });
  const cutoff = account?.sessionsValidAfter;
  if (!cutoff || session.createdAt.getTime() > cutoff.getTime()) return false;
  await sessions(db).updateOne(
    { _id: session._id, status: "ACTIVE" },
    { $set: { status: "REVOKED", revokedAt: now, revokedReason: "ADMIN" } },
  );
  return true;
}

/** Revokes one session by its database id, scoped to the owner. Idempotent. */
export async function revokeSessionById(
  db: Db,
  userId: ObjectId,
  sessionDbId: ObjectId,
  reason: SessionRevokeReason,
  now: Date = new Date(),
): Promise<"REVOKED" | "ALREADY_ENDED" | "NOT_FOUND"> {
  const result = await sessions(db).updateOne(
    { _id: sessionDbId, userId, status: "ACTIVE" },
    { $set: { status: "REVOKED", revokedAt: now, revokedReason: reason } },
  );
  if (result.modifiedCount === 1) return "REVOKED";
  const exists = await sessions(db).findOne({ _id: sessionDbId, userId }, { projection: { _id: 1 } });
  return exists ? "ALREADY_ENDED" : "NOT_FOUND";
}

/** Revokes every active session of a customer. Returns how many. */
export async function revokeAllSessions(
  db: Db,
  userId: ObjectId,
  reason: SessionRevokeReason,
  now: Date = new Date(),
): Promise<number> {
  const result = await sessions(db).updateMany(
    { userId, status: "ACTIVE" },
    { $set: { status: "REVOKED", revokedAt: now, revokedReason: reason } },
  );
  return result.modifiedCount;
}

export async function revokeDeviceSessions(
  db: Db,
  userId: string | ObjectId,
  deviceId: string | ObjectId,
  reason: SessionRevokeReason,
  now: Date = new Date(),
): Promise<number> {
  const result = await sessions(db).updateMany(
    {
      userId: requireObjectId(userId, "userId"),
      deviceId: requireObjectId(deviceId, "deviceId"),
      status: "ACTIVE",
    },
    { $set: { status: "REVOKED", revokedAt: now, revokedReason: reason } },
  );
  return result.modifiedCount;
}

/** Count of a user's live sessions. Groundwork for later concurrency checks. */
export async function countActiveSessions(
  db: Db,
  userId: string | ObjectId,
  now: Date = new Date(),
): Promise<number> {
  return sessions(db).countDocuments({
    userId: requireObjectId(userId, "userId"),
    status: "ACTIVE",
    expiresAt: { $gt: now },
  });
}
