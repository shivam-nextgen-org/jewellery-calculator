import { ObjectId, type Collection, type Db } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type AccountRestrictionPointer,
  type RestrictionDoc,
  type RestrictionLevel,
  type SecurityAccountDoc,
} from "@/lib/security/collections";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { recordSecurityEvent } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import { evaluateRiskEvents, type RiskEvent } from "@/lib/security/risk-rules";

/**
 * Temporary, reversible restrictions (I6, doc 04 §8, doc 05 §7).
 *
 * Approved policy:
 *   MEDIUM   → REVIEW_REQUIRED flag only. Access continues.
 *   HIGH     → block for SECURITY_RESTRICTION_HIGH_HOURS (default 24h), then
 *              expires on its own.
 *   CRITICAL → block pending admin review, at most
 *              SECURITY_RESTRICTION_CRITICAL_DAYS (default 7) from the start.
 *              At the maximum the block lifts; the review flag stays.
 *   LOW      → nothing.
 * Every restriction has an expiry. Nothing here can ban permanently.
 *
 * State: SecurityRestriction rows are the record (ACTIVE → EXPIRED | REMOVED,
 * or NOT_APPLIED if the row lost the race to be applied). SecurityAccount
 * holds the pointer that authorize() reads, plus `restrictionVersion`. Every
 * state change is a conditional update on the version read beforehand, so a
 * stale evaluation can't overwrite, resurrect or extend newer state.
 *
 * Bounded renewal:
 *  - An active restriction is never extended. HIGH → CRITICAL escalation
 *    happens at most once and its end is startedAt + CRITICAL maximum.
 *  - After a restriction ends (expiry or admin lift) a new one can only come
 *    from events after that moment (`restrictionEvidenceAfter`), so the same
 *    events still in the risk window can't re-restrict the customer.
 *  - A lower risk result never ends an active restriction early.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function accounts(db: Db): Collection<SecurityAccountDoc> {
  return db.collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account);
}
function restrictions(db: Db): Collection<RestrictionDoc> {
  return db.collection<RestrictionDoc>(SECURITY_COLLECTIONS.restriction);
}

export function isRestrictionActive(
  pointer: Pick<AccountRestrictionPointer, "expiresAt"> | null | undefined,
  now: Date,
): boolean {
  return Boolean(pointer && pointer.expiresAt.getTime() > now.getTime());
}

/** Filter matching the version we read (missing and null both match null). */
function versionFilter(version: number | null | undefined) {
  return { restrictionVersion: version ?? null };
}

/**
 * Ends a restriction whose time has passed. Idempotent; safe to call from any
 * path. Returns true if this call ended it.
 */
export async function settleExpiredRestriction(
  db: Db,
  userId: ObjectId,
  now: Date = new Date(),
): Promise<boolean> {
  const account = await accounts(db).findOne(
    { _id: userId },
    { projection: { restriction: 1, restrictionEvidenceAfter: 1 } },
  );
  const pointer = account?.restriction;
  if (!pointer || isRestrictionActive(pointer, now)) return false;
  const evidenceAfter =
    account?.restrictionEvidenceAfter && account.restrictionEvidenceAfter > pointer.expiresAt
      ? account.restrictionEvidenceAfter
      : pointer.expiresAt;
  const result = await accounts(db).updateOne(
    { _id: userId, "restriction.id": pointer.id, "restriction.expiresAt": { $lte: now } },
    {
      $set: { restriction: null, restrictionEvidenceAfter: evidenceAfter, updatedAt: now },
      $inc: { restrictionVersion: 1 },
    },
  );
  if (result.modifiedCount !== 1) return false;
  await restrictions(db).updateOne(
    { _id: pointer.id, status: "ACTIVE" },
    { $set: { status: "EXPIRED", endedAt: pointer.expiresAt } },
  );
  await recordSecurityEvent(db, {
    type: "RESTRICTION_EXPIRED",
    actorType: "SYSTEM",
    userId,
    reasonCodes: [`RESTRICTION_${pointer.level}`],
    metadata: { restrictionId: pointer.id.toHexString() },
    occurredAt: now,
  });
  return true;
}

export type RiskActionOutcome =
  | "NONE"
  | "REVIEW_FLAGGED"
  | "RESTRICTED"
  | "ESCALATED"
  | "ALREADY_RESTRICTED"
  | "STALE";

/**
 * Applies the approved policy for the current risk (only when the risk
 * engine is in `act` mode). `events` are the events the risk evaluation
 * loaded; only those after `restrictionEvidenceAfter` are used here.
 */
export async function applyRiskPolicy(
  db: Db,
  userId: ObjectId,
  events: RiskEvent[],
  assessmentId: ObjectId | null,
  config: SecurityConfig = getSecurityConfig(),
  now: Date = new Date(),
): Promise<RiskActionOutcome> {
  if (config.flags.riskEngine !== "act") return "NONE";
  await settleExpiredRestriction(db, userId, now);

  const account = await accounts(db).findOne(
    { _id: userId },
    {
      projection: {
        restriction: 1,
        restrictionVersion: 1,
        restrictionEvidenceAfter: 1,
        review: 1,
        reviewEvidenceAfter: 1,
      },
    },
  );
  if (!account) return "NONE";
  const version = account.restrictionVersion;
  const after = account.restrictionEvidenceAfter?.getTime() ?? 0;
  const evidence = events.filter((e) => e.occurredAt.getTime() > after);
  const result = evaluateRiskEvents(evidence, now, config.risk);
  const pointer = isRestrictionActive(account.restriction, now) ? account.restriction! : null;

  if (result.tier === "LOW") return "NONE";

  if (result.tier === "MEDIUM") {
    if (account.review || pointer) return pointer ? "ALREADY_RESTRICTED" : "NONE";
    // I7: after an admin cleared the flag, only newer evidence re-flags.
    const reviewAfter = account.reviewEvidenceAfter?.getTime() ?? 0;
    if (reviewAfter > after) {
      const fresh = evaluateRiskEvents(
        evidence.filter((e) => e.occurredAt.getTime() > reviewAfter),
        now,
        config.risk,
      );
      if (fresh.tier === "LOW") return "NONE";
    }
    const flagged = await accounts(db).updateOne(
      { _id: userId, review: { $in: [null] }, ...versionFilter(version) },
      {
        $set: { review: { since: now, source: "RISK_MEDIUM", restrictionId: null }, updatedAt: now },
        $inc: { restrictionVersion: 1 },
      },
    );
    if (flagged.modifiedCount !== 1) return "STALE";
    await recordSecurityEvent(db, {
      type: "REVIEW_FLAGGED",
      actorType: "SYSTEM",
      userId,
      reasonCodes: result.reasonCodes,
      metadata: { tier: result.tier },
      occurredAt: now,
    });
    return "REVIEW_FLAGGED";
  }

  const level: RestrictionLevel = result.tier === "CRITICAL" ? "CRITICAL" : "HIGH";

  if (pointer) {
    if (pointer.level === "CRITICAL" || level === "HIGH") return "ALREADY_RESTRICTED";
    // HIGH → CRITICAL, once. End = start + CRITICAL maximum (never later).
    const maxEnd = new Date(pointer.startedAt.getTime() + config.restrictions.criticalDays * DAY);
    const escalated = await accounts(db).updateOne(
      {
        _id: userId,
        "restriction.id": pointer.id,
        "restriction.level": "HIGH",
        "restriction.expiresAt": { $gt: now },
        ...versionFilter(version),
      },
      {
        $set: {
          "restriction.level": "CRITICAL",
          "restriction.expiresAt": maxEnd,
          review: { since: now, source: "RISK_CRITICAL", restrictionId: pointer.id },
          updatedAt: now,
        },
        $inc: { restrictionVersion: 1 },
      },
    );
    if (escalated.modifiedCount !== 1) return "STALE";
    await restrictions(db).updateOne(
      { _id: pointer.id, status: "ACTIVE" },
      {
        $set: {
          level: "CRITICAL",
          tier: result.tier,
          score: result.score,
          reasonCodes: result.reasonCodes,
          expiresAt: maxEnd,
          reviewRequired: true,
          escalatedAt: now,
          assessmentId,
        },
      },
    );
    await recordSecurityEvent(db, {
      type: "RESTRICTION_ESCALATED",
      actorType: "SYSTEM",
      userId,
      reasonCodes: result.reasonCodes,
      metadata: { restrictionId: pointer.id.toHexString(), level: "CRITICAL", expiresAt: maxEnd },
      occurredAt: now,
    });
    return "ESCALATED";
  }

  const maxExpiresAt = new Date(now.getTime() + config.restrictions.criticalDays * DAY);
  const expiresAt =
    level === "CRITICAL" ? maxExpiresAt : new Date(now.getTime() + config.restrictions.highHours * HOUR);
  const doc: RestrictionDoc = {
    _id: new ObjectId(),
    userId,
    status: "ACTIVE",
    level,
    source: "RISK_ENGINE",
    reason:
      level === "CRITICAL"
        ? "Automatic restriction pending administrator review (critical risk)"
        : "Automatic temporary restriction (high risk)",
    reasonCodes: result.reasonCodes,
    tier: result.tier,
    score: result.score,
    rulesetVersion: result.rulesetVersion,
    assessmentId,
    createdBy: null,
    createdAt: now,
    startedAt: now,
    expiresAt,
    maxExpiresAt,
    reviewRequired: level === "CRITICAL",
    escalatedAt: null,
    endedAt: null,
    removedBy: null,
    removalActionId: null,
    removalReason: null,
  };
  await restrictions(db).insertOne(doc);

  const claimed = await accounts(db).updateOne(
    {
      _id: userId,
      ...versionFilter(version),
      $or: [{ restriction: null }, { "restriction.expiresAt": { $lte: now } }],
    },
    {
      $set: {
        restriction: { id: doc._id, level, startedAt: now, expiresAt },
        ...(level === "CRITICAL"
          ? { review: { since: now, source: "RISK_CRITICAL", restrictionId: doc._id } }
          : {}),
        updatedAt: now,
      },
      $inc: { restrictionVersion: 1 },
    },
  );
  if (claimed.modifiedCount !== 1) {
    await restrictions(db).updateOne({ _id: doc._id }, { $set: { status: "NOT_APPLIED", endedAt: now } });
    return "STALE";
  }
  await recordSecurityEvent(db, {
    type: "RESTRICTION_CREATED",
    actorType: "SYSTEM",
    userId,
    reasonCodes: result.reasonCodes,
    metadata: { restrictionId: doc._id.toHexString(), level, expiresAt, reviewRequired: doc.reviewRequired },
    occurredAt: now,
  });
  return "RESTRICTED";
}

export type LiftOutcome = "REMOVED" | "ALREADY_ENDED" | "NOT_FOUND";

/**
 * Admin lift, called only after authorization, step-up and the audit record.
 * Conditional on the pointer still naming this restriction, so a repeated or
 * stale lift is a no-op. Clears the review flag (the admin has reviewed).
 * Doesn't touch devices, sessions or the concurrency counter.
 */
export async function liftRestriction(
  db: Db,
  input: { userId: ObjectId; restrictionId: ObjectId; adminId: ObjectId; actionId: ObjectId; reason: string; now?: Date },
): Promise<LiftOutcome> {
  const now = input.now ?? new Date();
  const result = await accounts(db).updateOne(
    { _id: input.userId, "restriction.id": input.restrictionId },
    {
      $set: { restriction: null, review: null, restrictionEvidenceAfter: now, updatedAt: now },
      $inc: { restrictionVersion: 1 },
    },
  );
  if (result.modifiedCount !== 1) {
    const doc = await restrictions(db).findOne({ _id: input.restrictionId, userId: input.userId });
    return doc ? "ALREADY_ENDED" : "NOT_FOUND";
  }
  await restrictions(db).updateOne(
    { _id: input.restrictionId, status: "ACTIVE" },
    {
      $set: {
        status: "REMOVED",
        endedAt: now,
        removedBy: input.adminId,
        removalActionId: input.actionId,
        removalReason: input.reason,
      },
    },
  );
  await recordSecurityEvent(db, {
    type: "RESTRICTION_REMOVED",
    actorType: "ADMIN",
    actorId: input.adminId,
    userId: input.userId,
    reasonCodes: ["ADMIN_LIFT"],
    metadata: { restrictionId: input.restrictionId.toHexString() },
    occurredAt: now,
  });
  return "REMOVED";
}

export type RestrictionState = {
  restricted: boolean;
  level: RestrictionLevel | null;
  expiresAt: Date | null;
  reviewRequired: boolean;
};

/** Current state for authorize() and the customer notice. */
export async function getRestrictionState(
  db: Db,
  userIdInput: unknown,
  now: Date = new Date(),
): Promise<RestrictionState> {
  const userId = parseObjectId(userIdInput);
  const none: RestrictionState = { restricted: false, level: null, expiresAt: null, reviewRequired: false };
  if (!userId) return none;
  const account = await accounts(db).findOne({ _id: userId }, { projection: { restriction: 1, review: 1 } });
  const active = isRestrictionActive(account?.restriction, now);
  return {
    restricted: active,
    level: active ? account!.restriction!.level : null,
    expiresAt: active ? account!.restriction!.expiresAt : null,
    reviewRequired: Boolean(account?.review),
  };
}

// ---------------------------------------------------------------------------
// I7 admin primitives. Callers do authorization, step-up and the audit
// record first; these only perform the conditional state change.
// ---------------------------------------------------------------------------

export type ClearReviewOutcome = "CLEARED" | "NOT_FLAGGED";

/**
 * Clears REVIEW_REQUIRED. Never touches an active restriction, devices,
 * sessions, risk history or events. Only newer evidence can re-flag.
 */
export async function clearReviewFlag(
  db: Db,
  input: { userId: ObjectId; adminId: ObjectId; now?: Date },
): Promise<ClearReviewOutcome> {
  const now = input.now ?? new Date();
  const result = await accounts(db).updateOne(
    { _id: input.userId, review: { $type: "object" } },
    {
      $set: { review: null, reviewEvidenceAfter: now, updatedAt: now },
      $inc: { restrictionVersion: 1 },
    },
  );
  if (result.modifiedCount !== 1) return "NOT_FLAGGED";
  await recordSecurityEvent(db, {
    type: "REVIEW_CLEARED",
    actorType: "ADMIN",
    actorId: input.adminId,
    userId: input.userId,
    reasonCodes: ["ADMIN_CLEARED"],
    occurredAt: now,
  });
  return "CLEARED";
}

export type AdminRestrictOutcome = "RESTRICTED" | "ALREADY_RESTRICTED";

/**
 * Admin-created temporary restriction. Same durations, expiry and
 * non-extension rules as risk-created ones; an active restriction is never
 * replaced or extended (lift it first).
 */
export async function createAdminRestriction(
  db: Db,
  input: {
    userId: ObjectId;
    adminId: ObjectId;
    level: RestrictionLevel;
    reason: string;
    actionId: ObjectId;
    now?: Date;
  },
  config: SecurityConfig = getSecurityConfig(),
): Promise<AdminRestrictOutcome> {
  const now = input.now ?? new Date();
  await settleExpiredRestriction(db, input.userId, now);
  const maxExpiresAt = new Date(now.getTime() + config.restrictions.criticalDays * DAY);
  const expiresAt =
    input.level === "CRITICAL"
      ? maxExpiresAt
      : new Date(now.getTime() + config.restrictions.highHours * HOUR);
  const doc: RestrictionDoc = {
    _id: new ObjectId(),
    userId: input.userId,
    status: "ACTIVE",
    level: input.level,
    source: "ADMIN",
    reason: input.reason,
    reasonCodes: ["ADMIN_RESTRICTION"],
    tier: input.level,
    score: 0,
    rulesetVersion: "admin",
    assessmentId: null,
    createdBy: input.adminId,
    createdAt: now,
    startedAt: now,
    expiresAt,
    maxExpiresAt,
    reviewRequired: input.level === "CRITICAL",
    escalatedAt: null,
    endedAt: null,
    removedBy: null,
    removalActionId: null,
    removalReason: null,
    createdActionId: input.actionId,
  };
  await restrictions(db).insertOne(doc);
  const claimed = await accounts(db).updateOne(
    { _id: input.userId, $or: [{ restriction: null }, { restriction: { $exists: false } }, { "restriction.expiresAt": { $lte: now } }] },
    {
      $set: {
        restriction: { id: doc._id, level: input.level, startedAt: now, expiresAt },
        ...(input.level === "CRITICAL"
          ? { review: { since: now, source: "RISK_CRITICAL", restrictionId: doc._id } }
          : {}),
        updatedAt: now,
      },
      $setOnInsert: { deviceSlotsUsed: 0, enrolledAt: null, enrolledDeviceId: null, createdAt: now },
      $inc: { restrictionVersion: 1 },
    },
    { upsert: true },
  ).catch(async (error) => {
    // Upsert raced an existing document that holds an active restriction.
    if ((error as { code?: number }).code === 11000) return { modifiedCount: 0, upsertedCount: 0 };
    throw error;
  });
  if (claimed.modifiedCount !== 1 && claimed.upsertedCount !== 1) {
    await restrictions(db).updateOne({ _id: doc._id }, { $set: { status: "NOT_APPLIED", endedAt: now } });
    return "ALREADY_RESTRICTED";
  }
  await recordSecurityEvent(db, {
    type: "RESTRICTION_CREATED",
    actorType: "ADMIN",
    actorId: input.adminId,
    userId: input.userId,
    reasonCodes: ["ADMIN_RESTRICTION"],
    metadata: { restrictionId: doc._id.toHexString(), level: input.level, expiresAt },
    occurredAt: now,
  });
  return "RESTRICTED";
}
