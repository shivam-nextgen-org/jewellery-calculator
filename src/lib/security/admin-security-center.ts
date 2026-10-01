import { ObjectId, type Db } from "mongodb";
import { decidePendingDevice } from "@/lib/security/admin-device-decisions";
import { liftRestrictionAsAdmin } from "@/lib/security/admin-restrictions";
import { verifyAdminStepUp } from "@/lib/security/admin-step-up";
import {
  SECURITY_COLLECTIONS,
  type DeviceDoc,
  type RestrictionDoc,
  type SecurityAccountDoc,
  type SessionDoc,
} from "@/lib/security/collections";
import { getSecurityConfig, LIMIT_BOUNDS, type SecurityConfig } from "@/lib/security/config";
import { safeReference } from "@/lib/security/crypto";
import { deviceReferenceCode } from "@/lib/security/device";
import {
  isPendingExpired,
  normalizeDeviceLabel,
  pendingDeadline,
  revokeDevice,
} from "@/lib/security/device-registry";
import { recordAdminAction, recordSecurityEvent } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import {
  clearReviewFlag,
  createAdminRestriction,
  isRestrictionActive,
  settleExpiredRestriction,
} from "@/lib/security/restriction";
import type { RiskAssessmentDoc } from "@/lib/security/risk";
import { revokeAllSessions, revokeSessionById } from "@/lib/security/session";

/**
 * Admin Security Center (I7): read models and administrative actions.
 *
 * Every action follows one path:
 *   active admin (live DB check) → validate input → password step-up (I3)
 *   → target belongs to this customer → no-op check (no audit for no-ops)
 *   → audit record (throws → nothing changes) → conditional/atomic change.
 *
 * Views never include passwords/hashes, JWTs, session ids or their hashes,
 * device secrets or their hashes, API keys, raw IPs or connection strings.
 * IPs appear only as an 8-character prefix of the existing keyed hash.
 */

type UserRow = {
  _id: ObjectId;
  email?: string;
  name?: string;
  role?: string;
  isActive?: boolean;
  createdAt?: Date;
};

function col<T extends object>(db: Db, name: string) {
  return db.collection<T>(name);
}

/** Live check: the JWT alone doesn't prove the admin is still enabled. */
export async function isActiveAdmin(db: Db, adminId: string): Promise<boolean> {
  const id = parseObjectId(adminId);
  if (!id) return false;
  const admin = await col<UserRow>(db, "User").findOne(
    { _id: id },
    { projection: { role: 1, isActive: 1 } },
  );
  return admin?.role === "SUPER_ADMIN" && admin.isActive === true;
}

async function findCustomer(db: Db, userId: ObjectId): Promise<UserRow | null> {
  const user = await col<UserRow>(db, "User").findOne(
    { _id: userId },
    { projection: { email: 1, name: 1, role: 1, isActive: 1, createdAt: 1 } },
  );
  return user?.role === "USER" ? user : null;
}

const iso = (d: Date | null | undefined) => (d instanceof Date ? d.toISOString() : null);

function effectiveLimits(account: SecurityAccountDoc | null, config: SecurityConfig) {
  const deviceOverride = typeof account?.deviceLimit === "number" ? account.deviceLimit : null;
  const sessionOverride =
    typeof account?.maxConcurrentSessions === "number" ? account.maxConcurrentSessions : null;
  return {
    deviceLimit: deviceOverride ?? config.limits.deviceLimit,
    deviceLimitOverride: deviceOverride,
    maxConcurrentSessions: sessionOverride ?? config.limits.maxConcurrentSessions,
    maxConcurrentSessionsOverride: sessionOverride,
    defaults: {
      deviceLimit: config.limits.deviceLimit,
      maxConcurrentSessions: config.limits.maxConcurrentSessions,
    },
    bounds: LIMIT_BOUNDS,
  };
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export type CustomerSummary = {
  userId: string;
  name: string | null;
  email: string | null;
  isActive: boolean;
  riskTier: string;
  reviewRequired: boolean;
  restricted: boolean;
  restrictionLevel: string | null;
  trustedDevices: number;
  pendingDevices: number;
};

export async function listCustomerSecurity(
  db: Db,
  now: Date = new Date(),
  limit = 200,
): Promise<CustomerSummary[]> {
  const users = await col<UserRow>(db, "User")
    .find({ role: "USER" }, { projection: { email: 1, name: 1, isActive: 1 } })
    .sort({ email: 1 })
    .limit(limit)
    .toArray();
  if (users.length === 0) return [];
  const ids = users.map((u) => u._id);
  const [accounts, deviceCounts] = await Promise.all([
    col<SecurityAccountDoc>(db, SECURITY_COLLECTIONS.account)
      .find({ _id: { $in: ids } }, { projection: { risk: 1, review: 1, restriction: 1 } })
      .toArray(),
    col<DeviceDoc>(db, SECURITY_COLLECTIONS.device)
      .aggregate<{ _id: { userId: ObjectId; status: string }; n: number }>([
        { $match: { userId: { $in: ids }, status: { $in: ["TRUSTED", "PENDING_VERIFICATION"] } } },
        { $group: { _id: { userId: "$userId", status: "$status" }, n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const byId = new Map(accounts.map((a) => [a._id.toHexString(), a]));
  const count = (userId: ObjectId, status: string) =>
    deviceCounts.find((c) => c._id.userId.equals(userId) && c._id.status === status)?.n ?? 0;
  return users.map((u) => {
    const a = byId.get(u._id.toHexString()) ?? null;
    const restricted = isRestrictionActive(a?.restriction, now);
    return {
      userId: u._id.toHexString(),
      name: u.name ?? null,
      email: u.email ?? null,
      isActive: u.isActive === true,
      riskTier: a?.risk?.tier ?? "LOW",
      reviewRequired: Boolean(a?.review),
      restricted,
      restrictionLevel: restricted ? a!.restriction!.level : null,
      trustedDevices: count(u._id, "TRUSTED"),
      pendingDevices: count(u._id, "PENDING_VERIFICATION"),
    };
  });
}

export type CustomerSecurityDetail = Awaited<ReturnType<typeof buildDetail>>;

export async function getCustomerSecurityDetail(
  db: Db,
  userIdInput: unknown,
  config: SecurityConfig = getSecurityConfig(),
  now: Date = new Date(),
) {
  const userId = parseObjectId(userIdInput);
  if (!userId) return null;
  const user = await findCustomer(db, userId);
  if (!user) return null;
  await settleExpiredRestriction(db, userId, now);
  return buildDetail(db, user, config, now);
}

async function buildDetail(db: Db, user: UserRow, config: SecurityConfig, now: Date) {
  const userId = user._id;
  const [account, devices, sessions, risks, restrictions, events, actions] = await Promise.all([
    col<SecurityAccountDoc>(db, SECURITY_COLLECTIONS.account).findOne({ _id: userId }),
    col<DeviceDoc>(db, SECURITY_COLLECTIONS.device)
      .find({ userId })
      .sort({ lastSeenAt: -1 })
      .limit(100)
      .toArray(),
    col<SessionDoc>(db, SECURITY_COLLECTIONS.session)
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
    col<RiskAssessmentDoc>(db, SECURITY_COLLECTIONS.riskAssessment)
      .find({ userId })
      .sort({ evaluatedAt: -1 })
      .limit(50)
      .toArray(),
    col<RestrictionDoc>(db, SECURITY_COLLECTIONS.restriction)
      .find({ userId, status: { $ne: "NOT_APPLIED" } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
    col<{
      _id: ObjectId;
      type: string;
      occurredAt: Date;
      actorType: string;
      deviceId: ObjectId | null;
      sessionRef: string | null;
      ipHash: string | null;
      coarseGeo?: string | null;
      reasonCodes: string[];
      metadata: Record<string, unknown>;
    }>(db, SECURITY_COLLECTIONS.event)
      .find({ userId })
      .sort({ occurredAt: -1 })
      .limit(100)
      .toArray(),
    col<{
      _id: ObjectId;
      occurredAt: Date;
      adminId: ObjectId;
      action: string;
      reason: string;
      metadata: Record<string, unknown>;
    }>(db, SECURITY_COLLECTIONS.adminAction)
      .find({ targetUserId: userId })
      .sort({ occurredAt: -1 })
      .limit(100)
      .toArray(),
  ]);

  const adminIds = [
    ...new Set([
      ...actions.map((a) => a.adminId.toHexString()),
      ...restrictions.flatMap((r) => [r.createdBy, r.removedBy].filter(Boolean).map((id) => id!.toHexString())),
    ]),
  ].map((id) => new ObjectId(id));
  const admins = adminIds.length
    ? await col<UserRow>(db, "User")
        .find({ _id: { $in: adminIds } }, { projection: { email: 1 } })
        .toArray()
    : [];
  const adminEmail = (id: ObjectId | null | undefined) =>
    id ? (admins.find((a) => a._id.equals(id))?.email ?? "unknown admin") : null;
  const deviceLabel = (id: ObjectId) => {
    const d = devices.find((x) => x._id.equals(id));
    return d ? d.label ?? ([d.browserFamily, d.platform].filter(Boolean).join(" on ") || "Device") : "Device";
  };
  const validAfter = account?.sessionsValidAfter ?? null;
  const restrictionActive = isRestrictionActive(account?.restriction, now);

  return {
    customer: {
      userId: userId.toHexString(),
      name: user.name ?? null,
      email: user.email ?? null,
      isActive: user.isActive === true,
      createdAt: iso(user.createdAt),
    },
    status: {
      accountState: user.isActive !== true
        ? "DISABLED"
        : restrictionActive
          ? "RESTRICTED"
          : account?.review
            ? "REVIEW_REQUIRED"
            : "ACTIVE",
      enrolledAt: iso(account?.enrolledAt),
      deviceSlotsUsed: account?.deviceSlotsUsed ?? 0,
      sessionsValidAfter: iso(validAfter),
      limits: effectiveLimits(account, config),
    },
    risk: {
      current: account?.risk
        ? {
            tier: account.risk.tier,
            score: account.risk.score,
            reasonCodes: account.risk.reasonCodes,
            recommendedAction: account.risk.recommendedAction,
            evaluatedAt: iso(account.risk.evaluatedAt),
          }
        : null,
      review: account?.review
        ? { since: iso(account.review.since), source: account.review.source }
        : null,
      history: risks.map((r) => ({
        id: r._id.toHexString(),
        evaluatedAt: iso(r.evaluatedAt),
        mode: r.mode,
        tier: r.tier,
        previousTier: r.previousTier,
        score: r.score,
        reasonCodes: r.reasonCodes,
        contributions: r.contributions,
        recommendedAction: r.recommendedAction,
        rulesetVersion: r.rulesetVersion,
      })),
    },
    restrictions: {
      active: restrictionActive
        ? {
            id: account!.restriction!.id.toHexString(),
            level: account!.restriction!.level,
            startedAt: iso(account!.restriction!.startedAt),
            expiresAt: iso(account!.restriction!.expiresAt),
          }
        : null,
      history: restrictions.map((r) => ({
        id: r._id.toHexString(),
        level: r.level,
        status:
          r.status === "ACTIVE" && r.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : r.status,
        source: r.source,
        reason: r.reason,
        reasonCodes: r.reasonCodes,
        reviewRequired: r.reviewRequired,
        startedAt: iso(r.startedAt),
        expiresAt: iso(r.expiresAt),
        endedAt: iso(r.endedAt),
        createdBy: adminEmail(r.createdBy),
        removedBy: adminEmail(r.removedBy),
        removalReason: r.removalReason,
      })),
    },
    devices: devices.map((d) => {
      const expired = d.status === "EXPIRED" || isPendingExpired(d, now, config);
      return {
        id: d._id.toHexString(),
        label: d.label,
        platform: d.platform,
        browserFamily: d.browserFamily,
        status: expired ? "EXPIRED" : d.status,
        revokedReason: d.revokedReason ?? null,
        verificationMethod: d.verificationMethod ?? null,
        firstSeenAt: iso(d.firstSeenAt),
        lastSeenAt: iso(d.lastSeenAt),
        verifiedAt: iso(d.verifiedAt),
        revokedAt: iso(d.revokedAt),
        referenceCode: d.status === "PENDING_VERIFICATION" ? deviceReferenceCode(d._id) : null,
        pendingExpiresAt:
          d.status === "PENDING_VERIFICATION" && !expired ? iso(pendingDeadline(d, config)) : null,
      };
    }),
    sessions: sessions.map((s) => {
      const forcedOut = Boolean(validAfter && s.createdAt.getTime() <= validAfter.getTime());
      const status =
        s.status !== "ACTIVE" || forcedOut
          ? "REVOKED"
          : s.expiresAt.getTime() <= now.getTime()
            ? "EXPIRED"
            : "ACTIVE";
      return {
        id: s._id.toHexString(),
        ref: safeReference(s.sessionIdHash),
        deviceId: s.deviceId.toHexString(),
        deviceLabel: deviceLabel(s.deviceId),
        status,
        revokedReason: s.revokedReason ?? (forcedOut ? "ADMIN" : null),
        rememberMe: s.rememberMe,
        createdAt: iso(s.createdAt),
        lastActivityAt: iso(s.lastActivityAt),
        expiresAt: iso(s.expiresAt),
        revokedAt: iso(s.revokedAt),
      };
    }),
    events: events.map((e) => ({
      id: e._id.toHexString(),
      type: e.type,
      occurredAt: iso(e.occurredAt),
      actorType: e.actorType,
      deviceId: e.deviceId ? e.deviceId.toHexString() : null,
      sessionRef: e.sessionRef,
      networkRef: e.ipHash ? e.ipHash.slice(0, 8) : null,
      country: e.coarseGeo ?? null,
      reasonCodes: e.reasonCodes,
      metadata: e.metadata,
    })),
    adminActions: actions.map((a) => ({
      id: a._id.toHexString(),
      occurredAt: iso(a.occurredAt),
      admin: adminEmail(a.adminId),
      action: a.action,
      reason: a.reason,
      metadata: a.metadata,
    })),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ADMIN_SECURITY_ACTIONS = [
  "DEVICE_APPROVE",
  "DEVICE_REJECT",
  "DEVICE_REVOKE",
  "DEVICE_RENAME",
  "SESSION_REVOKE",
  "FORCE_LOGOUT",
  "REVIEW_CLEAR",
  "RESTRICTION_CREATE",
  "RESTRICTION_LIFT",
  "LIMITS_SET",
] as const;
export type AdminSecurityAction = (typeof ADMIN_SECURITY_ACTIONS)[number];

export type ActionRequest = {
  adminId: string;
  userId: unknown;
  action: unknown;
  body: Record<string, unknown>;
  ip?: string | null;
  now?: Date;
};

export type ActionResult =
  | { ok: true; outcome: string; applied: boolean }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 429; error: string };

const STEP_UP_ERRORS = {
  400: "Enter your password to confirm this action.",
  401: "Password confirmation failed.",
  429: "Too many failed confirmations. Try again in 15 minutes.",
} as const;

function reasonOf(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return value && value.length <= 300 ? value : null;
}

/** null clears the override; undefined leaves it; otherwise an integer within bounds. */
function limitOf(input: unknown): number | null | undefined | "INVALID" {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input === "number" && Number.isInteger(input) && input >= LIMIT_BOUNDS.min && input <= LIMIT_BOUNDS.max) {
    return input;
  }
  return "INVALID";
}

const fail = (status: 400 | 403 | 404 | 409, error: string): ActionResult => ({ ok: false, status, error });
const done = (outcome: string, applied: boolean): ActionResult => ({ ok: true, outcome, applied });

export async function performAdminSecurityAction(
  db: Db,
  request: ActionRequest,
  config: SecurityConfig = getSecurityConfig(),
): Promise<ActionResult> {
  const now = request.now ?? new Date();
  if (!(await isActiveAdmin(db, request.adminId))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const action = request.action as AdminSecurityAction;
  if (!ADMIN_SECURITY_ACTIONS.includes(action)) return fail(400, "Unknown action");
  const userId = parseObjectId(request.userId);
  if (!userId) return fail(404, "Not found");
  const customer = await findCustomer(db, userId);
  if (!customer) return fail(404, "Not found");
  const b = request.body;

  // These already implement step-up → target → audit → change (I3/I6).
  if (action === "DEVICE_APPROVE" || action === "DEVICE_REJECT") {
    const r = await decidePendingDevice(db, action === "DEVICE_APPROVE" ? "APPROVE" : "REJECT", {
      adminId: request.adminId,
      deviceId: b.deviceId,
      userId,
      password: b.password,
      reason: b.reason,
      ip: request.ip,
      now,
    }, config);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    return done(r.outcome, r.outcome === "TRUSTED" || r.outcome === "REJECTED");
  }
  if (action === "RESTRICTION_LIFT") {
    if (config.flags.restrictions !== "on") return fail(409, "Restrictions are not enabled.");
    const r = await liftRestrictionAsAdmin(db, {
      adminId: request.adminId,
      restrictionId: b.restrictionId,
      userId,
      password: b.password,
      reason: b.reason,
      ip: request.ip,
      now,
    });
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    return done(r.outcome, r.outcome === "REMOVED");
  }

  const reason =
    reasonOf(b.reason) ?? (action === "DEVICE_RENAME" ? "Renamed by administrator" : null);
  if (!reason) return fail(400, "A reason (up to 300 characters) is required.");

  // Validate the request shape before step-up, so typos don't count as failures.
  const deviceId = parseObjectId(b.deviceId);
  const sessionId = parseObjectId(b.sessionId);
  if ((action === "DEVICE_REVOKE" || action === "DEVICE_RENAME") && !deviceId) return fail(404, "Not found");
  if (action === "SESSION_REVOKE" && !sessionId) return fail(404, "Not found");
  const label = action === "DEVICE_RENAME" ? normalizeDeviceLabel(b.label) : null;
  if (action === "DEVICE_RENAME" && label === undefined) {
    return fail(400, "label must be text up to 40 characters");
  }
  const level = b.level === "HIGH" || b.level === "CRITICAL" ? b.level : null;
  if (action === "RESTRICTION_CREATE") {
    if (config.flags.restrictions !== "on") return fail(409, "Restrictions are not enabled.");
    if (!level) return fail(400, "level must be HIGH or CRITICAL");
  }
  const newDeviceLimit = action === "LIMITS_SET" ? limitOf(b.deviceLimit) : undefined;
  const newSessionLimit = action === "LIMITS_SET" ? limitOf(b.maxConcurrentSessions) : undefined;
  if (action === "LIMITS_SET") {
    if (newDeviceLimit === "INVALID" || newSessionLimit === "INVALID") {
      return fail(400, `Limits must be whole numbers from ${LIMIT_BOUNDS.min} to ${LIMIT_BOUNDS.max}, or null for the default.`);
    }
    if (newDeviceLimit === undefined && newSessionLimit === undefined) return fail(400, "Nothing to change");
  }

  const stepUp = await verifyAdminStepUp(db, request.adminId, b.password, { action, ip: request.ip }, now);
  if (!stepUp.ok) return { ok: false, status: stepUp.status, error: STEP_UP_ERRORS[stepUp.status] };

  const adminId = new ObjectId(request.adminId);
  const audit = (metadata: Record<string, unknown>) =>
    recordAdminAction(db, { adminId, action, targetUserId: userId, reason, ip: request.ip, metadata, occurredAt: now });
  const devicesCol = col<DeviceDoc>(db, SECURITY_COLLECTIONS.device);
  const accountsCol = col<SecurityAccountDoc>(db, SECURITY_COLLECTIONS.account);

  switch (action) {
    case "DEVICE_REVOKE": {
      const device = await devicesCol.findOne({ _id: deviceId!, userId });
      if (!device) return fail(404, "Not found");
      if (device.status !== "TRUSTED" && device.status !== "PENDING_VERIFICATION") {
        return done("ALREADY_REVOKED", false);
      }
      await audit({ deviceId: deviceId!.toHexString() });
      const r = await revokeDevice(db, userId, deviceId, now, "ADMIN_REVOKED");
      if (r.state === "REVOKED") {
        await recordSecurityEvent(db, {
          type: "DEVICE_REVOKED",
          actorType: "ADMIN",
          actorId: adminId,
          userId,
          deviceId: deviceId!,
          reasonCodes: ["ADMIN_REVOKED"],
          metadata: { sessionsRevoked: r.sessionsRevoked },
          occurredAt: now,
        });
      }
      return done(r.state, r.state === "REVOKED");
    }

    case "DEVICE_RENAME": {
      const device = await devicesCol.findOne({ _id: deviceId!, userId });
      if (!device) return fail(404, "Not found");
      if (device.status !== "TRUSTED" && device.status !== "PENDING_VERIFICATION") {
        return fail(409, "Only active devices can be renamed.");
      }
      if (device.label === label) return done("UNCHANGED", false);
      await audit({ deviceId: deviceId!.toHexString() });
      const r = await devicesCol.updateOne(
        { _id: deviceId!, userId, status: { $in: ["TRUSTED", "PENDING_VERIFICATION"] } },
        { $set: { label, updatedAt: now } },
      );
      if (r.modifiedCount === 1) {
        await recordSecurityEvent(db, {
          type: "DEVICE_RENAMED", actorType: "ADMIN", actorId: adminId, userId, deviceId: deviceId!, occurredAt: now,
        });
      }
      return done(r.modifiedCount === 1 ? "RENAMED" : "NOT_RENAMED", r.modifiedCount === 1);
    }

    case "SESSION_REVOKE": {
      const session = await col<SessionDoc>(db, SECURITY_COLLECTIONS.session).findOne({ _id: sessionId!, userId });
      if (!session) return fail(404, "Not found");
      if (session.status !== "ACTIVE") return done("ALREADY_ENDED", false);
      await audit({ sessionRef: safeReference(session.sessionIdHash) });
      const outcome = await revokeSessionById(db, userId, sessionId!, "ADMIN", now);
      if (outcome === "REVOKED") {
        await recordSecurityEvent(db, {
          type: "SESSION_REVOKED", actorType: "ADMIN", actorId: adminId, userId, deviceId: session.deviceId,
          sessionRef: safeReference(session.sessionIdHash), reasonCodes: ["ADMIN_REVOKED"], occurredAt: now,
        });
      }
      return done(outcome, outcome === "REVOKED");
    }

    case "FORCE_LOGOUT": {
      const active = await col<SessionDoc>(db, SECURITY_COLLECTIONS.session).countDocuments({
        userId, status: "ACTIVE", expiresAt: { $gt: now },
      });
      if (active === 0) return done("NO_ACTIVE_SESSIONS", false);
      await audit({ activeSessions: active });
      // Cutoff first: covers a login that inserts its session after the sweep.
      await accountsCol.updateOne(
        { _id: userId },
        {
          $max: { sessionsValidAfter: now },
          $set: { updatedAt: now },
          $setOnInsert: { deviceSlotsUsed: 0, enrolledAt: null, enrolledDeviceId: null, createdAt: now },
        },
        { upsert: true },
      );
      const revoked = await revokeAllSessions(db, userId, "ADMIN", now);
      await recordSecurityEvent(db, {
        type: "SESSION_REVOKED", actorType: "ADMIN", actorId: adminId, userId,
        reasonCodes: ["ADMIN_FORCE_LOGOUT"], metadata: { sessionsRevoked: revoked }, occurredAt: now,
      });
      return done("LOGGED_OUT", true);
    }

    case "REVIEW_CLEAR": {
      const account = await accountsCol.findOne({ _id: userId }, { projection: { review: 1 } });
      if (!account?.review) return done("NOT_FLAGGED", false);
      await audit({ reviewSince: account.review.since.toISOString(), source: account.review.source });
      const outcome = await clearReviewFlag(db, { userId, adminId, now });
      return done(outcome, outcome === "CLEARED");
    }

    case "RESTRICTION_CREATE": {
      const account = await accountsCol.findOne({ _id: userId }, { projection: { restriction: 1 } });
      if (isRestrictionActive(account?.restriction, now)) return done("ALREADY_RESTRICTED", false);
      const record = await audit({ level });
      const outcome = await createAdminRestriction(
        db, { userId, adminId, level: level!, reason, actionId: record._id, now }, config,
      );
      return done(outcome, outcome === "RESTRICTED");
    }

    case "LIMITS_SET": {
      const account = await accountsCol.findOne(
        { _id: userId }, { projection: { deviceLimit: 1, maxConcurrentSessions: 1 } },
      );
      const before = {
        deviceLimit: typeof account?.deviceLimit === "number" ? account.deviceLimit : null,
        maxConcurrentSessions: typeof account?.maxConcurrentSessions === "number" ? account.maxConcurrentSessions : null,
      };
      const after = {
        deviceLimit: newDeviceLimit === undefined ? before.deviceLimit : (newDeviceLimit as number | null),
        maxConcurrentSessions:
          newSessionLimit === undefined ? before.maxConcurrentSessions : (newSessionLimit as number | null),
      };
      if (after.deviceLimit === before.deviceLimit && after.maxConcurrentSessions === before.maxConcurrentSessions) {
        return done("UNCHANGED", false);
      }
      await audit({ before, after });
      // Conditional on the values just read: a concurrent change by another
      // admin is reported, not silently overwritten.
      const r = await accountsCol.updateOne(
        {
          _id: userId,
          deviceLimit: before.deviceLimit,
          maxConcurrentSessions: before.maxConcurrentSessions,
        },
        {
          $set: { ...after, updatedAt: now },
          $setOnInsert: { deviceSlotsUsed: 0, enrolledAt: null, enrolledDeviceId: null, createdAt: now },
        },
        { upsert: !account },
      ).catch((error: { code?: number }) => {
        if (error.code === 11000) return { modifiedCount: 0, upsertedCount: 0 };
        throw error;
      });
      if (r.modifiedCount !== 1 && r.upsertedCount !== 1) {
        return fail(409, "The limits were changed by someone else. Reload and try again.");
      }
      return done("UPDATED", true);
    }
  }
  return fail(400, "Unknown action");
}
