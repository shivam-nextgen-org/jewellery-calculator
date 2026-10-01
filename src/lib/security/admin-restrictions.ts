import { ObjectId, type Db } from "mongodb";
import { verifyAdminStepUp } from "@/lib/security/admin-step-up";
import {
  SECURITY_COLLECTIONS,
  type RestrictionDoc,
  type SecurityAccountDoc,
} from "@/lib/security/collections";
import { recordAdminAction } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import {
  isRestrictionActive,
  liftRestriction,
  settleExpiredRestriction,
  type LiftOutcome,
} from "@/lib/security/restriction";

/**
 * Admin restriction primitives for I6 (the full Security Center is I7).
 *
 * Lift order: step-up → target check → audit record → conditional state
 * change. If the audit write fails, nothing changes. A repeated or stale lift
 * (the restriction already ended) is a no-op without an audit row.
 */

const REASON_MAX = 300;

function cleanReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return value && value.length <= REASON_MAX ? value : null;
}

export type LiftRequest = {
  adminId: string;
  restrictionId: unknown;
  userId: unknown;
  password: unknown;
  reason: unknown;
  ip?: string | null;
  now?: Date;
};

export type LiftResult =
  | { ok: true; outcome: LiftOutcome }
  | { ok: false; status: 400 | 401 | 404 | 429; error: string };

const STEP_UP_ERRORS = {
  400: "Enter your password to confirm this action.",
  401: "Password confirmation failed.",
  429: "Too many failed confirmations. Try again in 15 minutes.",
} as const;

export async function liftRestrictionAsAdmin(db: Db, request: LiftRequest): Promise<LiftResult> {
  const now = request.now ?? new Date();
  const restrictionId = parseObjectId(request.restrictionId);
  const userId = parseObjectId(request.userId);
  if (!restrictionId || !userId) return { ok: false, status: 404, error: "Not found" };
  const reason = cleanReason(request.reason);
  if (!reason) return { ok: false, status: 400, error: "A reason (up to 300 characters) is required." };

  const stepUp = await verifyAdminStepUp(db, request.adminId, request.password, {
    action: "RESTRICTION_REMOVED",
    ip: request.ip,
  }, now);
  if (!stepUp.ok) return { ok: false, status: stepUp.status, error: STEP_UP_ERRORS[stepUp.status] };

  const [owner, doc, account] = await Promise.all([
    db.collection<{ role?: string }>("User").findOne({ _id: userId }, { projection: { role: 1 } }),
    db.collection<RestrictionDoc>(SECURITY_COLLECTIONS.restriction).findOne({ _id: restrictionId, userId }),
    db
      .collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account)
      .findOne({ _id: userId }, { projection: { restriction: 1 } }),
  ]);
  if (owner?.role !== "USER" || !doc) return { ok: false, status: 404, error: "Not found" };
  const current =
    account?.restriction?.id.equals(restrictionId) && isRestrictionActive(account.restriction, now);
  if (!current) {
    await settleExpiredRestriction(db, userId, now);
    return { ok: true, outcome: "ALREADY_ENDED" };
  }

  const adminId = new ObjectId(request.adminId);
  const audit = await recordAdminAction(db, {
    adminId,
    action: "RESTRICTION_REMOVED",
    targetUserId: userId,
    reason,
    ip: request.ip,
    metadata: { restrictionId: restrictionId.toHexString(), level: doc.level },
    occurredAt: now,
  });
  const outcome = await liftRestriction(db, {
    userId,
    restrictionId,
    adminId,
    actionId: audit._id,
    reason,
    now,
  });
  return { ok: true, outcome };
}

export type RestrictedAccountView = {
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  restriction: {
    id: string;
    level: "HIGH" | "CRITICAL";
    reason: string;
    reasonCodes: string[];
    startedAt: string;
    expiresAt: string;
    reviewRequired: boolean;
  } | null;
  reviewSince: string | null;
};

/** Customers with an active restriction or a review flag (admin-only view). */
export async function listRestrictedAccounts(
  db: Db,
  now: Date = new Date(),
  limit = 100,
): Promise<RestrictedAccountView[]> {
  const accountsCol = db.collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account);
  const expired = await accountsCol
    .find({ "restriction.expiresAt": { $lte: now } }, { projection: { _id: 1 } })
    .limit(200)
    .toArray();
  for (const { _id } of expired) await settleExpiredRestriction(db, _id, now);

  const rows = await accountsCol
    .find(
      { $or: [{ "restriction.expiresAt": { $gt: now } }, { review: { $type: "object" } }] },
      { projection: { restriction: 1, review: 1 } },
    )
    .limit(limit)
    .toArray();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r._id);
  const [users, docs] = await Promise.all([
    db
      .collection<{ _id: ObjectId; name?: string; email?: string; role?: string }>("User")
      .find({ _id: { $in: ids }, role: "USER" }, { projection: { name: 1, email: 1 } })
      .toArray(),
    db
      .collection<RestrictionDoc>(SECURITY_COLLECTIONS.restriction)
      .find({ _id: { $in: rows.flatMap((r) => (r.restriction ? [r.restriction.id] : [])) } })
      .toArray(),
  ]);
  const userById = new Map(users.map((u) => [u._id.toHexString(), u]));
  const docById = new Map(docs.map((d) => [d._id.toHexString(), d]));
  return rows
    .filter((r) => userById.has(r._id.toHexString()))
    .map((r) => {
      const user = userById.get(r._id.toHexString());
      const doc = r.restriction ? docById.get(r.restriction.id.toHexString()) : undefined;
      return {
        userId: r._id.toHexString(),
        customerName: user?.name ?? null,
        customerEmail: user?.email ?? null,
        restriction:
          r.restriction && doc
            ? {
                id: r.restriction.id.toHexString(),
                level: r.restriction.level,
                reason: doc.reason,
                reasonCodes: doc.reasonCodes,
                startedAt: r.restriction.startedAt.toISOString(),
                expiresAt: r.restriction.expiresAt.toISOString(),
                reviewRequired: doc.reviewRequired,
              }
            : null,
        reviewSince: r.review?.since ? r.review.since.toISOString() : null,
      };
    })
    .sort((a, b) => (b.restriction ? 1 : 0) - (a.restriction ? 1 : 0));
}
