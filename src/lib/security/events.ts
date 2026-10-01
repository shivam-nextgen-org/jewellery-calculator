import { ObjectId, type Db } from "mongodb";
import { SECURITY_COLLECTIONS } from "@/lib/security/collections";
import { RETENTION } from "@/lib/security/config";
import { hashIp, SAFE_REFERENCE_PATTERN } from "@/lib/security/crypto";
import { parseObjectId } from "@/lib/security/ids";

/**
 * Append-only security event + admin audit writers (I1).
 *
 * Rules (ADR-017):
 * - Never store raw session ids, JWTs, cookies, OTPs, passwords, API keys or
 *   SESSION_SECRET. `sessionRef` must be a safe reference (see sessionRef()).
 * - IPs are stored only as a keyed hash.
 * - Metadata is sanitized: secret-looking keys are dropped, secret-looking
 *   values are redacted, size and depth are capped.
 * - Writing an event must never break the request that triggered it
 *   (fail-open + log), so writers swallow errors and report success as a bool.
 */

export const SECURITY_EVENT_TYPES = [
  "USER_CREATED",
  "LICENSE_GRANTED",
  "LICENSE_REVOKED",
  "LOGIN_ATTEMPT",
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "OTP_SENT",
  "OTP_VERIFIED",
  "OTP_FAILED",
  "DEVICE_DETECTED",
  "DEVICE_REGISTERED",
  "DEVICE_VERIFIED",
  "DEVICE_REVOKED",
  "DEVICE_EXPIRED",
  "DEVICE_RENAMED",
  "DEVICE_REJECTED",
  "ADMIN_STEP_UP_SUCCEEDED",
  "ADMIN_STEP_UP_FAILED",
  "DEVICE_LIMIT_REACHED",
  "DEVICE_COOKIE_REJECTED",
  "SESSION_CREATED",
  "SESSION_REVOKED",
  "SESSION_DEVICE_MISMATCH",
  "SESSION_EVICTED",
  "CONCURRENT_SESSION_DETECTED",
  "ACCESS_DENIED",
  "ACCESS_WOULD_DENY",
  "RISK_EVALUATED",
  "RISK_ESCALATED",
  "RESTRICTION_CREATED",
  "RESTRICTION_ESCALATED",
  "REVIEW_FLAGGED",
  "REVIEW_CLEARED",
  "RESTRICTION_EXPIRED",
  "RESTRICTION_REMOVED",
  "ADMIN_ACTION",
  "ADMIN_OVERRIDE",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const ACTOR_TYPES = ["USER", "ADMIN", "API_KEY", "SYSTEM", "CRON"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | MetadataValue[]
  | { [key: string]: MetadataValue };

export type SecurityEventInput = {
  type: SecurityEventType;
  actorType: ActorType;
  actorId?: string | ObjectId | null;
  userId?: string | ObjectId | null;
  deviceId?: string | ObjectId | null;
  /** Output of sessionRef(); raw session ids are rejected. */
  sessionRef?: string | null;
  ip?: string | null;
  /** ISO 3166 alpha-2 country from a trusted proxy header (I5). Anything else is dropped. */
  coarseGeo?: string | null;
  requestId?: string | null;
  reasonCodes?: string[];
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

export type SecurityEventDoc = {
  _id: ObjectId;
  type: SecurityEventType;
  occurredAt: Date;
  expiresAt: Date;
  actorType: ActorType;
  actorId: ObjectId | null;
  userId: ObjectId | null;
  deviceId: ObjectId | null;
  sessionRef: string | null;
  ipHash: string | null;
  coarseGeo?: string | null;
  requestId: string | null;
  reasonCodes: string[];
  metadata: Record<string, MetadataValue>;
};

const COUNTRY = /^[A-Z]{2}$/;
/** Cloudflare's placeholders for unknown / Tor. Not a location. */
const NON_COUNTRIES = new Set(["XX", "T1"]);

export function normalizeCountry(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && COUNTRY.test(code) && !NON_COUNTRIES.has(code) ? code : null;
}

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 3;
const MAX_KEYS = 25;
const MAX_ARRAY = 20;
const MAX_STRING = 256;

/** Keys whose values must never be persisted, whatever they contain. */
const SENSITIVE_KEY =
  /pass(word)?|pwd|secret|token|jwt|cookie|authorization|auth_?header|otp|code_?hash|api_?key|key_?hash|session_?id|sessionidhash|credential|private|bearer|signature/i;

/** Values that look like credentials even under an innocent key. */
const SENSITIVE_VALUE: RegExp[] = [
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/, // JWT
  /\batl_[A-Za-z0-9_-]{8,}/, // API key
  /^\$2[aby]\$\d{2}\$/, // bcrypt hash
  /^bearer\s+/i,
  /^[A-Za-z0-9_-]{32,}$/, // long opaque token (device secret / session id)
  /^[a-f0-9]{40,}$/i, // long hex digest
];

function sanitizeString(value: string): string {
  if (SENSITIVE_VALUE.some((pattern) => pattern.test(value.trim()))) {
    return REDACTED;
  }
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

function sanitizeValue(value: unknown, depth: number): MetadataValue | undefined {
  if (value === null) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is MetadataValue => item !== undefined);
  }
  if (typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>, depth + 1);
  }
  return undefined; // functions, symbols, bigint, undefined
}

function sanitizeObject(
  input: Record<string, unknown>,
  depth: number,
): Record<string, MetadataValue> {
  const out: Record<string, MetadataValue> = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_KEYS)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const clean = sanitizeValue(value, depth);
    if (clean !== undefined) out[key.slice(0, 64)] = clean;
  }
  return out;
}

export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, MetadataValue> {
  if (!metadata || typeof metadata !== "object") return {};
  return sanitizeObject(metadata, 0);
}

const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Pure: turn an input into the exact document that will be stored. */
export function buildSecurityEvent(
  input: SecurityEventInput,
  secret: string | undefined = process.env.SESSION_SECRET,
): SecurityEventDoc {
  if (!SECURITY_EVENT_TYPES.includes(input.type)) {
    throw new TypeError("Unknown security event type");
  }
  if (!ACTOR_TYPES.includes(input.actorType)) {
    throw new TypeError("Unknown actor type");
  }
  const occurredAt = input.occurredAt ?? new Date();
  const sessionRef =
    input.sessionRef && SAFE_REFERENCE_PATTERN.test(input.sessionRef)
      ? input.sessionRef
      : null;
  return {
    _id: new ObjectId(),
    type: input.type,
    occurredAt,
    expiresAt: new Date(
      occurredAt.getTime() + RETENTION.securityEventDays * 24 * 60 * 60 * 1000,
    ),
    actorType: input.actorType,
    actorId: parseObjectId(input.actorId),
    userId: parseObjectId(input.userId),
    deviceId: parseObjectId(input.deviceId),
    sessionRef,
    ipHash: hashIp(input.ip, secret),
    ...(input.coarseGeo !== undefined ? { coarseGeo: normalizeCountry(input.coarseGeo) } : {}),
    requestId:
      input.requestId && REQUEST_ID.test(input.requestId) ? input.requestId : null,
    reasonCodes: (input.reasonCodes ?? [])
      .filter((code) => REASON_CODE.test(code))
      .slice(0, 20),
    metadata: sanitizeMetadata(input.metadata),
  };
}

function reportWriteFailure(kind: string, type: string, error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  // Deliberately no error message/stack: driver errors can echo documents.
  console.error(`[security] failed to record ${kind} ${type} (${name})`);
}

export async function recordSecurityEvent(
  db: Db,
  input: SecurityEventInput,
): Promise<boolean> {
  try {
    const doc = buildSecurityEvent(input);
    await db
      .collection<SecurityEventDoc>(SECURITY_COLLECTIONS.event)
      .insertOne(doc);
    return true;
  } catch (error) {
    reportWriteFailure("security event", String(input?.type), error);
    return false;
  }
}

export type AdminActionInput = {
  adminId: string | ObjectId;
  action: string;
  targetUserId?: string | ObjectId | null;
  reason: string;
  ip?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

export type AdminActionDoc = {
  _id: ObjectId;
  occurredAt: Date;
  adminId: ObjectId;
  action: string;
  targetUserId: ObjectId | null;
  reason: string;
  ipHash: string | null;
  requestId: string | null;
  metadata: Record<string, MetadataValue>;
};

const ADMIN_ACTION = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Pure: build an admin audit record. Admin actions require an admin id and a reason. */
export function buildAdminAction(
  input: AdminActionInput,
  secret: string | undefined = process.env.SESSION_SECRET,
): AdminActionDoc {
  const adminId = parseObjectId(input.adminId);
  if (!adminId) throw new TypeError("adminId is required");
  if (!ADMIN_ACTION.test(input.action)) throw new TypeError("Invalid action");
  const reason = input.reason?.trim();
  if (!reason) throw new TypeError("reason is required");
  return {
    _id: new ObjectId(),
    occurredAt: input.occurredAt ?? new Date(),
    adminId,
    action: input.action,
    targetUserId: parseObjectId(input.targetUserId),
    reason: sanitizeString(reason.slice(0, 500)),
    ipHash: hashIp(input.ip, secret),
    requestId:
      input.requestId && REQUEST_ID.test(input.requestId) ? input.requestId : null,
    metadata: sanitizeMetadata(input.metadata),
  };
}

/**
 * Admin audit trail: separate collection, no TTL (retained >= 2 years, G8).
 * Unlike security events, a failed audit write is returned to the caller so a
 * privileged action can refuse to proceed without an audit record.
 */
export async function recordAdminAction(
  db: Db,
  input: AdminActionInput,
): Promise<AdminActionDoc> {
  const doc = buildAdminAction(input);
  await db
    .collection<AdminActionDoc>(SECURITY_COLLECTIONS.adminAction)
    .insertOne(doc);
  return doc;
}
