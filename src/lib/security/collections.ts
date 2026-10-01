/**
 * Security collection names and document shapes.
 *
 * These collections are deliberately NOT declared in prisma/schema.prisma:
 * `prisma db push` removes indexes it doesn't know about on modeled
 * collections, and Prisma can't express the TTL indexes that enforce the
 * approved retention periods. Their indexes are owned by ./indexes.ts.
 */
import type { ObjectId } from "mongodb";

export const SECURITY_COLLECTIONS = {
  /** One document per customer (`_id` = User `_id`): device slots + enrollment marker. */
  account: "SecurityAccount",
  device: "SecurityDevice",
  session: "SecuritySession",
  event: "SecurityEvent",
  adminAction: "SecurityAdminAction",
  /** I5: history of risk assessments (only stored when the result changes). */
  riskAssessment: "SecurityRiskAssessment",
  /** I6: temporary restrictions (append-only record; the account holds a pointer). */
  restriction: "SecurityRestriction",
} as const;

/** HIGH: fixed-period block. CRITICAL: block pending admin review, bounded maximum. */
export const RESTRICTION_LEVELS = ["HIGH", "CRITICAL"] as const;
export type RestrictionLevel = (typeof RESTRICTION_LEVELS)[number];

/**
 * ACTIVE → EXPIRED (expiresAt passed) | REMOVED (admin lift).
 * NOT_APPLIED = inserted but lost the race to claim the account (never enforced).
 */
export const RESTRICTION_STATUSES = ["ACTIVE", "EXPIRED", "REMOVED", "NOT_APPLIED"] as const;
export type RestrictionStatus = (typeof RESTRICTION_STATUSES)[number];

export type RestrictionDoc = {
  _id: ObjectId;
  userId: ObjectId;
  status: RestrictionStatus;
  level: RestrictionLevel;
  source: "RISK_ENGINE" | "ADMIN";
  /** Human-readable reason (admin-facing). */
  reason: string;
  reasonCodes: string[];
  tier: RiskTier;
  score: number;
  rulesetVersion: string;
  assessmentId: ObjectId | null;
  /** null = created by the system (risk engine). */
  createdBy: ObjectId | null;
  createdAt: Date;
  startedAt: Date;
  expiresAt: Date;
  /** Hard ceiling from startedAt; escalation can never go past it. */
  maxExpiresAt: Date;
  reviewRequired: boolean;
  escalatedAt: Date | null;
  endedAt: Date | null;
  removedBy: ObjectId | null;
  removalActionId: ObjectId | null;
  removalReason: string | null;
  /** I7: audit record of an admin-created restriction. */
  createdActionId?: ObjectId | null;
};

/** What authorize() reads on every request (kept on SecurityAccount). */
export type AccountRestrictionPointer = {
  id: ObjectId;
  level: RestrictionLevel;
  startedAt: Date;
  expiresAt: Date;
};

/** REVIEW_REQUIRED flag: admin attention, never blocks (doc 04 §8). */
export type AccountReviewFlag = {
  since: Date;
  source: "RISK_MEDIUM" | "RISK_CRITICAL";
  restrictionId: ObjectId | null;
};

export const RISK_TIERS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/** Architecture mapping (doc 04 §7). I5 records it; nothing acts on it yet. */
export const RISK_ACTIONS = ["ALLOW", "ALLOW_LOG", "STEP_UP", "RESTRICT", "REVIEW"] as const;
export type RiskAction = (typeof RISK_ACTIONS)[number];

/** Current risk, kept on SecurityAccount for cheap reads by I6/I7. */
export type AccountRiskState = {
  tier: RiskTier;
  score: number;
  reasonCodes: string[];
  recommendedAction: RiskAction;
  fingerprint: string;
  rulesetVersion: string;
  assessmentId: ObjectId;
  evaluatedAt: Date;
};

/**
 * Per-customer security state. The atomic slot counter makes the device limit
 * race-safe; `enrolledAt` is the durable one-time grandfathering marker.
 * The future License fields (doc 05 §1.1) will live on this document.
 */
export type SecurityAccountDoc = {
  _id: ObjectId;
  /** Devices currently holding a slot (PENDING_VERIFICATION or TRUSTED). */
  deviceSlotsUsed: number;
  /** Set once, when the first device is auto-trusted. Never cleared. */
  enrolledAt: Date | null;
  enrolledDeviceId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  /** I4: incremented atomically for every counted session start. Highest wins. */
  sessionGeneration?: number;
  /** I5: latest risk assessment result. */
  risk?: AccountRiskState;
  /** I6: the active restriction, if any. Authoritative for enforcement. */
  restriction?: AccountRestrictionPointer | null;
  /** I6: incremented on every restriction/review state change (optimistic concurrency). */
  restrictionVersion?: number | null;
  /** I6: new restrictions only from events after this (end of the last one / last admin lift). */
  restrictionEvidenceAfter?: Date | null;
  /** I6: REVIEW_REQUIRED flag. */
  review?: AccountReviewFlag | null;
  /** I7: MEDIUM review flags only from events after this (last admin clear). */
  reviewEvidenceAfter?: Date | null;
  /** I7: per-customer overrides of the configured limits (null = default). */
  deviceLimit?: number | null;
  maxConcurrentSessions?: number | null;
  /** I7: sessions created at/before this instant are ended (admin force logout). */
  sessionsValidAfter?: Date | null;
};

export const DEVICE_STATUSES = [
  "PENDING_VERIFICATION",
  "TRUSTED",
  "REVOKED",
  "EXPIRED",
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export type DeviceDoc = {
  _id: ObjectId;
  userId: ObjectId;
  /** sha256 of the opaque device secret. The raw secret only lives in the cookie. */
  secretHash: string;
  status: DeviceStatus;
  label: string | null;
  platform: string | null;
  browserFamily: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  verifiedAt: Date | null;
  revokedAt: Date | null;
  /** TTL anchor: set only when a device leaves active use (revoked/expired). */
  purgeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * I3: deadline for a PENDING_VERIFICATION device (24h). Absent on devices
   * created before I3; those use createdAt + 24h.
   */
  pendingExpiresAt?: Date | null;
  /** I3: why a REVOKED device was revoked (rejection is REVOKED + ADMIN_REJECTED). */
  revokedReason?: DeviceRevokeReason | null;
  /** I3: how the device became TRUSTED. */
  verificationMethod?: DeviceVerificationMethod | null;
  /** I3: admin who approved/rejected, and the audit record that did it. */
  decidedBy?: ObjectId | null;
  decisionActionId?: ObjectId | null;
};

export const DEVICE_REVOKE_REASONS = [
  "USER_REVOKED",
  "ADMIN_REJECTED",
  "ADMIN_REVOKED",
] as const;
export type DeviceRevokeReason = (typeof DEVICE_REVOKE_REASONS)[number];

/** ENROLLMENT = the one-time auto-trusted first device (I2). */
export const DEVICE_VERIFICATION_METHODS = ["ENROLLMENT", "ADMIN_APPROVAL"] as const;
export type DeviceVerificationMethod = (typeof DEVICE_VERIFICATION_METHODS)[number];

export const SESSION_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_REVOKE_REASONS = [
  "LOGOUT",
  "ADMIN",
  "EVICTED",
  "RISK",
  "DEVICE_REVOKED",
  "ACCOUNT_DISABLED",
  /** A new login on the same device replaced its previous session. */
  "REPLACED",
] as const;
// "EVICTED" (listed above) = ended by a newer session on another device (I4, NEWEST_WINS).
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export type SessionDoc = {
  _id: ObjectId;
  /** sha256 of the opaque session id. The raw id is never stored. */
  sessionIdHash: string;
  userId: ObjectId;
  deviceId: ObjectId;
  status: SessionStatus;
  rememberMe: boolean;
  createdAt: Date;
  lastActivityAt: Date;
  /** Also the TTL anchor: the document is purged once this passes. */
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevokeReason | null;
  /**
   * I4: position in the customer's session order (SecurityAccount.sessionGeneration
   * at creation). Missing/null on sessions created before I4 or while
   * concurrency is off; treated as 0.
   */
  generation?: number | null;
  /**
   * I4: session on a pending device while device trust is enforced. It can't
   * be used, so it neither counts toward nor evicts under the limit until the
   * device is approved (then it gets a generation).
   */
  pendingExempt?: boolean;
  /** I4: inserted, generation not claimed yet (mid-login). Sweeps skip it. */
  generationPending?: boolean;
};
