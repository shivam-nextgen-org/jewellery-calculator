import { MongoServerError, type Collection, type Db, type ObjectId } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type SecurityAccountDoc,
  type SessionDoc,
} from "@/lib/security/collections";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { safeReference } from "@/lib/security/crypto";
import { recordSecurityEvent } from "@/lib/security/events";
import { requireObjectId } from "@/lib/security/ids";
import { startDeviceSession, type CreateSessionInput } from "@/lib/security/session";

/**
 * Concurrent-session limit, NEWEST_WINS (I4).
 *
 * Algorithm (optimistic concurrency, no transactions, no locks):
 *
 *  1. Insert the new session (same-device replacement from I2 happens here),
 *     marked `generationPending`.
 *  2. Claim a number: atomic `$inc` of SecurityAccount.sessionGeneration.
 *     MongoDB serialises increments on one document, so numbers are unique
 *     and totally ordered. Newest = highest `generation`.
 *  3. Stamp the number on the session (only if it is still ACTIVE).
 *  4. Sweep: revoke (EVICTED) every other counted ACTIVE session with
 *     generation <= mine - max.
 *  5. Self-check: if `max` or more counted ACTIVE sessions have a higher
 *     generation than mine, revoke myself (EVICTED).
 *
 * Authority on every request (context.ts) is the same rule as step 5: a
 * session is refused once `max` newer counted sessions are ACTIVE, even if
 * its own row hasn't been swept yet.
 *
 * Why this is race-safe: numbers are claimed only after the row exists, and
 * each login stamps its number before its own sweep and self-check. For two
 * racing logins, whichever finishes its self-check later sees the other's
 * number and resolves the pair (the lower one is evicted, by the higher one's
 * sweep or by its own self-check). Sweeps skip `generationPending` rows, so a
 * login that is about to claim the highest number can't be swept first.
 * A session is never evicted by its own sweep (own `_id` is excluded), and a
 * session that lost a same-device replacement is REPLACED, not counted.
 *
 * Counted = ACTIVE, not expired, not `pendingExempt`, not `generationPending`.
 * Missing generation (sessions from before I4) counts as 0.
 *
 * Pending devices: while device trust is enforced a pending device's session
 * can't be used, so it claims no number and evicts nothing (`pendingExempt`).
 * On approval it is promoted: it claims a number and evicts older sessions.
 */

type Mode = SecurityConfig["flags"]["concurrency"];

function accounts(db: Db): Collection<SecurityAccountDoc> {
  return db.collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account);
}

function sessions(db: Db): Collection<SessionDoc> {
  return db.collection<SessionDoc>(SECURITY_COLLECTIONS.session);
}

/** Atomically claims the next session generation for a customer. */
export async function claimSessionGeneration(
  db: Db,
  userId: ObjectId,
  now: Date = new Date(),
): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const account = await accounts(db).findOneAndUpdate(
        { _id: userId },
        {
          $inc: { sessionGeneration: 1 },
          $set: { updatedAt: now },
          $setOnInsert: {
            deviceSlotsUsed: 0,
            enrolledAt: null,
            enrolledDeviceId: null,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      return account?.sessionGeneration ?? 1;
    } catch (error) {
      // Two first-ever upserts can race; the document exists on retry.
      if (!(error instanceof MongoServerError && error.code === 11000) || attempt > 0) throw error;
    }
  }
}

/** Pure: is a session with `generation` within the limit given `newerActive` newer sessions? */
export function isWithinLimit(newerActive: number, maxConcurrentSessions: number): boolean {
  return newerActive < maxConcurrentSessions;
}

function counted(now: Date) {
  return {
    status: "ACTIVE" as const,
    expiresAt: { $gt: now },
    pendingExempt: { $ne: true },
    generationPending: { $ne: true },
  };
}

/** How many counted sessions of this customer are newer than `generation`. */
async function countNewer(
  db: Db,
  userId: ObjectId,
  exceptId: ObjectId,
  generation: number | null | undefined,
  now: Date,
): Promise<number> {
  return sessions(db).countDocuments({
    userId,
    _id: { $ne: exceptId },
    ...counted(now),
    generation: { $gt: generation ?? 0 },
  });
}

/** Revokes one session as EVICTED (idempotent). Returns true if this call did it. */
async function evict(db: Db, session: Pick<SessionDoc, "_id">, now: Date): Promise<boolean> {
  const result = await sessions(db).updateOne(
    { _id: session._id, status: "ACTIVE" },
    { $set: { status: "REVOKED", revokedAt: now, revokedReason: "EVICTED" } },
  );
  return result.modifiedCount === 1;
}

async function recordEviction(
  db: Db,
  evicted: Pick<SessionDoc, "userId" | "deviceId" | "sessionIdHash" | "generation">,
  by: { deviceId: ObjectId; generation: number } | null,
) {
  await recordSecurityEvent(db, {
    type: "SESSION_EVICTED",
    actorType: "SYSTEM",
    userId: evicted.userId,
    deviceId: evicted.deviceId,
    sessionRef: safeReference(evicted.sessionIdHash),
    reasonCodes: ["NEWEST_WINS"],
    metadata: {
      evictedGeneration: evicted.generation ?? 0,
      byDeviceId: by?.deviceId.toHexString() ?? null,
      byGeneration: by?.generation ?? null,
      sameDevice: by ? by.deviceId.equals(evicted.deviceId) : false,
    },
  });
}

export type ConcurrencyOutcome = {
  mode: Mode;
  generation: number | null;
  /** Other-device sessions that were (enforce) or would be (detect) ended. */
  evicted: number;
  otherActiveBefore: number;
  /** The session didn't survive: a newer one won, or it was replaced mid-login. */
  selfEvicted: boolean;
};

const NO_OUTCOME = (mode: Mode): ConcurrencyOutcome => ({
  mode,
  generation: null,
  evicted: 0,
  otherActiveBefore: 0,
  selfEvicted: false,
});

/**
 * Steps 4–5 for a session that has just been stamped with `generation`.
 * detect: records what would happen, changes nothing.
 */
export async function applyNewestWins(
  db: Db,
  session: Pick<SessionDoc, "_id" | "userId" | "deviceId" | "sessionIdHash">,
  generation: number,
  config: SecurityConfig,
  now: Date = new Date(),
): Promise<ConcurrencyOutcome> {
  const mode = config.flags.concurrency;
  const outcome: ConcurrencyOutcome = { ...NO_OUTCOME(mode), generation };
  if (mode === "off") return outcome;
  const max = await effectiveSessionLimit(db, session.userId, config);

  const candidates = await sessions(db)
    .find(
      {
        userId: session.userId,
        _id: { $ne: session._id },
        ...counted(now),
        $or: [
          { generation: { $lte: generation - max } },
          { generation: null },
          { generation: { $exists: false } },
        ],
      },
      { projection: { _id: 1, userId: 1, deviceId: 1, sessionIdHash: 1, generation: 1 } },
    )
    .limit(100)
    .toArray();
  outcome.otherActiveBefore = candidates.length;

  if (mode === "detect") {
    outcome.evicted = candidates.length;
    if (candidates.length > 0) {
      await recordSecurityEvent(db, {
        type: "CONCURRENT_SESSION_DETECTED",
        actorType: "SYSTEM",
        userId: session.userId,
        deviceId: session.deviceId,
        reasonCodes: ["NEWEST_WINS"],
        metadata: { mode, wouldEvict: candidates.length, generation, maxConcurrentSessions: max },
      });
    }
    return outcome;
  }

  const by = { deviceId: session.deviceId, generation };
  for (const candidate of candidates) {
    if (await evict(db, candidate, now)) {
      outcome.evicted += 1;
      await recordEviction(db, candidate, by);
    }
  }
  if (outcome.evicted > 0) {
    await recordSecurityEvent(db, {
      type: "CONCURRENT_SESSION_DETECTED",
      actorType: "SYSTEM",
      userId: session.userId,
      deviceId: session.deviceId,
      reasonCodes: ["NEWEST_WINS"],
      metadata: { mode, evicted: outcome.evicted, generation, maxConcurrentSessions: max },
    });
  }

  // A newer login may have finished while we were working. Step aside if so.
  const newer = await countNewer(db, session.userId, session._id, generation, now);
  if (!isWithinLimit(newer, max)) {
    if (await evict(db, session, now)) await recordEviction(db, { ...session, generation }, null);
    outcome.selfEvicted = true;
  }
  return outcome;
}

/** Steps 2–5 for a session that already exists. */
async function countSession(
  db: Db,
  session: Pick<SessionDoc, "_id" | "userId" | "deviceId" | "sessionIdHash">,
  config: SecurityConfig,
  now: Date,
  unset: "generationPending" | "pendingExempt",
): Promise<ConcurrencyOutcome> {
  const generation = await claimSessionGeneration(db, session.userId, now);
  const stamped = await sessions(db).updateOne(
    { _id: session._id, status: "ACTIVE", [unset]: true },
    { $set: { generation }, $unset: { [unset]: "" } },
  );
  if (stamped.modifiedCount !== 1) {
    // Replaced by a concurrent login on the same device, or the device was
    // revoked. The number is simply unused.
    return { ...NO_OUTCOME(config.flags.concurrency), generation, selfEvicted: true };
  }
  return applyNewestWins(db, session, generation, config, now);
}

/**
 * Starts a device session and applies the concurrency policy.
 * Same-device replacement (I2) is unchanged and happens inside
 * startDeviceSession.
 */
export async function startSessionWithConcurrency(
  db: Db,
  input: CreateSessionInput,
  config: SecurityConfig = getSecurityConfig(),
): Promise<({ sessionId: string; session: SessionDoc } & { concurrency: ConcurrencyOutcome }) | null> {
  const now = input.now ?? new Date();
  const userId = requireObjectId(input.userId, "userId");
  const deviceId = requireObjectId(input.deviceId, "deviceId");
  const mode = config.flags.concurrency;

  let pendingExempt = false;
  if (mode !== "off" && config.flags.deviceTrust === "enforce") {
    const device = await db
      .collection<{ status: string }>(SECURITY_COLLECTIONS.device)
      .findOne({ _id: deviceId, userId }, { projection: { status: 1 } });
    pendingExempt = device?.status === "PENDING_VERIFICATION";
  }
  const counts = mode !== "off" && !pendingExempt;

  const started = await startDeviceSession(
    db,
    { ...input, userId, deviceId, now, generation: null, pendingExempt, generationPending: counts },
    config,
  );
  if (!started) return null;
  if (!counts) return { ...started, concurrency: NO_OUTCOME(mode) };

  const concurrency = await countSession(db, started.session, config, now, "generationPending");
  const session = concurrency.selfEvicted
    ? started.session
    : { ...started.session, generation: concurrency.generation, generationPending: undefined };
  return { sessionId: started.sessionId, session, concurrency };
}

/**
 * I3 approval hook: a pending device's exempt sessions become countable, as
 * if the customer had just logged in on that device (NEWEST_WINS).
 */
export async function promoteApprovedDeviceSessions(
  db: Db,
  userId: ObjectId,
  deviceId: ObjectId,
  config: SecurityConfig = getSecurityConfig(),
  now: Date = new Date(),
): Promise<number> {
  if (config.flags.concurrency === "off") return 0;
  const exempt = await sessions(db)
    .find(
      { userId, deviceId, status: "ACTIVE", pendingExempt: true },
      { projection: { _id: 1, userId: 1, deviceId: 1, sessionIdHash: 1 } },
    )
    .toArray();
  let promoted = 0;
  for (const session of exempt) {
    const outcome = await countSession(db, session, config, now, "pendingExempt");
    if (outcome.generation !== null && !outcome.selfEvicted) promoted += 1;
  }
  return promoted;
}

/**
 * Per-request check (enforce only): true if `max` newer sessions are active.
 * Also revokes the row so the database converges (idempotent).
 */
export async function isEvictedByNewerSession(
  db: Db,
  session: SessionDoc,
  config: SecurityConfig,
  now: Date = new Date(),
): Promise<boolean> {
  if (config.flags.concurrency !== "enforce") return false;
  if (session.pendingExempt && config.flags.deviceTrust === "enforce") return false;
  // A login that never finished counting (its id is never handed to a
  // client in that case) must not be usable.
  if (session.generationPending) {
    if (await evict(db, session, now)) await recordEviction(db, session, null);
    return true;
  }
  const max = await effectiveSessionLimit(db, session.userId, config);
  const newer = await countNewer(db, session.userId, session._id, session.generation, now);
  if (isWithinLimit(newer, max)) return false;
  if (await evict(db, session, now)) await recordEviction(db, session, null);
  return true;
}

/**
 * I7: per-customer override (admin-set, bounded) or the configured default.
 * Read fresh each time, so a change applies to the next login and the next
 * request: lowering it ends the oldest sessions beyond the new limit
 * (NEWEST_WINS), raising it ends none.
 */
export async function effectiveSessionLimit(
  db: Db,
  userId: ObjectId,
  config: SecurityConfig,
): Promise<number> {
  const account = await accounts(db).findOne(
    { _id: userId },
    { projection: { maxConcurrentSessions: 1 } },
  );
  const override = account?.maxConcurrentSessions;
  return typeof override === "number" && override >= 1 ? override : config.limits.maxConcurrentSessions;
}
