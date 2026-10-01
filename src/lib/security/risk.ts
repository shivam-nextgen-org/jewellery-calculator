import { MongoServerError, ObjectId, type Collection, type Db } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type AccountRiskState,
  type RiskTier,
  type SecurityAccountDoc,
} from "@/lib/security/collections";
import {
  getSecurityConfig,
  RETENTION,
  RISK_MAX_LOOKBACK_DAYS,
  type SecurityConfig,
} from "@/lib/security/config";
import { recordSecurityEvent } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import { applyRiskPolicy, type RiskActionOutcome } from "@/lib/security/restriction";
import {
  evaluateRiskEvents,
  tierRank,
  type RiskEvent,
  type RiskResult,
} from "@/lib/security/risk-rules";

/**
 * Risk evaluation service (I5). Loads a customer's recent security events,
 * runs the pure rules and records the result. Advisory only: nothing here
 * blocks, restricts or bans. I6 reads `SecurityAccount.risk`.
 *
 * Idempotent and race-safe: the current result lives on SecurityAccount.risk
 * with a fingerprint (ruleset + tier + reason codes). The update only applies
 * when the fingerprint differs and the stored result isn't newer, so repeated
 * or concurrent evaluations of the same situation write at most one history
 * row and one event. Risk falls again on its own as events leave their
 * windows — nothing is permanent.
 */

/** Only the event types the rules read. */
export const RISK_EVENT_TYPES = [
  "SESSION_CREATED",
  "SESSION_EVICTED",
  "CONCURRENT_SESSION_DETECTED",
  "DEVICE_REGISTERED",
  "DEVICE_REJECTED",
  "DEVICE_EXPIRED",
  "DEVICE_LIMIT_REACHED",
  "SESSION_DEVICE_MISMATCH",
  "LOGIN_FAILED",
] as const;

/** Bound on events read per evaluation. */
export const RISK_EVENT_LIMIT = 2000;

const DAY_MS = 86_400_000;

type StoredEvent = {
  _id: ObjectId;
  type: string;
  occurredAt: Date;
  deviceId?: ObjectId | null;
  sessionRef?: string | null;
  ipHash?: string | null;
  coarseGeo?: string | null;
  reasonCodes?: string[];
  metadata?: Record<string, unknown>;
};

export type RiskAssessmentDoc = {
  _id: ObjectId;
  userId: ObjectId;
  evaluatedAt: Date;
  expiresAt: Date;
  mode: SecurityConfig["flags"]["riskEngine"];
  tier: RiskTier;
  previousTier: RiskTier | null;
  score: number;
  reasonCodes: string[];
  contributions: RiskResult["contributions"];
  signals: RiskResult["signals"];
  dataQuality: RiskResult["dataQuality"] & { truncated: boolean };
  recommendedAction: RiskResult["recommendedAction"];
  rulesetVersion: string;
};

function accounts(db: Db): Collection<SecurityAccountDoc> {
  return db.collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account);
}

export async function loadRiskEvents(
  db: Db,
  userId: ObjectId,
  now: Date,
): Promise<{ events: RiskEvent[]; truncated: boolean }> {
  const since = new Date(now.getTime() - RISK_MAX_LOOKBACK_DAYS * DAY_MS);
  const rows = await db
    .collection<StoredEvent>(SECURITY_COLLECTIONS.event)
    .find(
      { userId, occurredAt: { $gt: since }, type: { $in: [...RISK_EVENT_TYPES] } },
      {
        projection: {
          type: 1, occurredAt: 1, deviceId: 1, sessionRef: 1, ipHash: 1, coarseGeo: 1, reasonCodes: 1, metadata: 1,
        },
      },
    )
    .sort({ occurredAt: -1 })
    .limit(RISK_EVENT_LIMIT + 1)
    .toArray();
  const truncated = rows.length > RISK_EVENT_LIMIT;
  return {
    truncated,
    events: rows.slice(0, RISK_EVENT_LIMIT).map((row) => ({
      id: row._id.toHexString(),
      type: row.type,
      occurredAt: row.occurredAt,
      deviceId: row.deviceId ? row.deviceId.toHexString() : null,
      sessionRef: row.sessionRef ?? null,
      ipHash: row.ipHash ?? null,
      coarseGeo: row.coarseGeo ?? null,
      reasonCodes: row.reasonCodes ?? [],
      metadata: row.metadata ?? {},
    })),
  };
}

export type RiskEvaluation = {
  result: RiskResult;
  changed: boolean;
  previousTier: RiskTier | null;
  assessmentId: ObjectId | null;
  /** I6: what the policy did (only in `act` mode; otherwise "NONE"). */
  action?: RiskActionOutcome;
};

/**
 * Evaluates one customer now and, in `act` mode, applies the restriction
 * policy (I6). Returns null when the engine is off or the account isn't a
 * customer. Throws on database errors (callers fail open).
 */
export async function evaluateCustomerRisk(
  db: Db,
  userIdInput: unknown,
  config: SecurityConfig = getSecurityConfig(),
  now: Date = new Date(),
): Promise<RiskEvaluation | null> {
  const evaluation = await recordCustomerRisk(db, userIdInput, config, now);
  if (!evaluation) return null;
 if (config.flags.riskEngine !== "act") return stripEvents(evaluation);
  const userId = parseObjectId(userIdInput)!;
  const assessmentId =
    evaluation.assessmentId ?? (await getCustomerRisk(db, userId))?.assessmentId ?? null;
  const action = await applyRiskPolicy(db, userId, evaluation.events, assessmentId, config, now);
  return { ...stripEvents(evaluation), action };
}

function stripEvents(e: RiskEvaluation & { events: RiskEvent[] }): RiskEvaluation {
  const { events, ...rest } = e;
  void events;
  return rest;
}

async function recordCustomerRisk(
  db: Db,
  userIdInput: unknown,
  config: SecurityConfig,
  now: Date,
): Promise<(RiskEvaluation & { events: RiskEvent[] }) | null> {
  const mode = config.flags.riskEngine;
  if (mode === "off") return null;
  const userId = parseObjectId(userIdInput);
  if (!userId) return null;
  const user = await db.collection<{ role?: string }>("User").findOne({ _id: userId }, { projection: { role: 1 } });
  if (user?.role !== "USER") return null;

  const { events, truncated } = await loadRiskEvents(db, userId, now);
  const result = evaluateRiskEvents(events, now, config.risk);

  const current = await accounts(db).findOne({ _id: userId }, { projection: { risk: 1 } });
  const previousTier = current?.risk?.tier ?? null;
  // Nothing to record for a customer with no history and nothing detected.
  if (!current?.risk && result.reasonCodes.length === 0) {
    return { result, changed: false, previousTier, assessmentId: null, events };
  }

  const assessmentId = new ObjectId();
  const state: AccountRiskState = {
    tier: result.tier,
    score: result.score,
    reasonCodes: result.reasonCodes,
    recommendedAction: result.recommendedAction,
    fingerprint: result.fingerprint,
    rulesetVersion: result.rulesetVersion,
    assessmentId,
    evaluatedAt: now,
  };

  let applied = false;
  try {
    await accounts(db).updateOne(
      {
        _id: userId,
        "risk.fingerprint": { $ne: result.fingerprint },
        $or: [{ risk: { $exists: false } }, { "risk.evaluatedAt": { $lte: now } }],
      },
      {
        $set: { risk: state, updatedAt: now },
        $setOnInsert: { deviceSlotsUsed: 0, enrolledAt: null, enrolledDeviceId: null, createdAt: now },
      },
      { upsert: true },
    );
    applied = true;
  } catch (error) {
    // The document exists but didn't match: same fingerprint, or a newer
    // evaluation already won. Either way there is nothing to record.
    if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
  }
  if (!applied) return { result, changed: false, previousTier, assessmentId: null, events };

  const history: RiskAssessmentDoc = {
    _id: assessmentId,
    userId,
    evaluatedAt: now,
    expiresAt: new Date(now.getTime() + RETENTION.riskAssessmentDays * DAY_MS),
    mode,
    tier: result.tier,
    previousTier,
    score: result.score,
    reasonCodes: result.reasonCodes,
    contributions: result.contributions,
    signals: result.signals,
    dataQuality: { ...result.dataQuality, truncated },
    recommendedAction: result.recommendedAction,
    rulesetVersion: result.rulesetVersion,
  };
  await db.collection<RiskAssessmentDoc>(SECURITY_COLLECTIONS.riskAssessment).insertOne(history);

  const escalated = previousTier === null ? tierRank(result.tier) > 0 : tierRank(result.tier) > tierRank(previousTier);
  const metadata = {
    tier: result.tier,
    previousTier,
    score: result.score,
    recommendedAction: result.recommendedAction,
    mode,
    rulesetVersion: result.rulesetVersion,
  };
  await recordSecurityEvent(db, {
    type: "RISK_EVALUATED",
    actorType: "SYSTEM",
    userId,
    reasonCodes: result.reasonCodes,
    metadata,
    occurredAt: now,
  });
  if (escalated) {
    await recordSecurityEvent(db, {
      type: "RISK_ESCALATED",
      actorType: "SYSTEM",
      userId,
      reasonCodes: result.reasonCodes,
      metadata,
      occurredAt: now,
    });
  }
  return { result, changed: true, previousTier, assessmentId, events };
}

/** Current advisory risk for I6/I7. Absent = LOW. */
export async function getCustomerRisk(db: Db, userIdInput: unknown): Promise<AccountRiskState | null> {
  const userId = parseObjectId(userIdInput);
  if (!userId) return null;
  return (await accounts(db).findOne({ _id: userId }, { projection: { risk: 1 } }))?.risk ?? null;
}

/**
 * Fire-and-forget evaluation for request paths (doc 04 §14: risk engine is
 * fail-open and must not gate requests). Never throws.
 */
export async function evaluateCustomerRiskSafely(
  db: Db,
  userId: unknown,
  config: SecurityConfig = getSecurityConfig(),
  now: Date = new Date(),
): Promise<void> {
  if (config.flags.riskEngine === "off") return;
  try {
    await evaluateCustomerRisk(db, userId, config, now);
  } catch (error) {
    console.error(`[security] risk evaluation failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}
