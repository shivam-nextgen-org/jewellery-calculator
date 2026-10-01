import { shouldUseSecureCookie } from "@/lib/auth/cookie-security";
import { REMEMBER_DAYS, SESSION_DAYS } from "@/lib/auth/token";

/**
 * Single source of truth for security limits, feature flags and retention.
 * Nothing else in the app should hard-code these values.
 *
 * Every flag defaults to "off". Invalid values fall back to "off" (never to an
 * enforcing mode) and are reported in `warnings`.
 */

const FLAG_DEFINITIONS = {
  /** I1: live account re-check in requireUser/requireAdmin via authorize(). */
  accessDecision: {
    env: "SECURITY_ACCESS_DECISION",
    modes: ["off", "shadow", "enforce"],
  },
  /** I2: server sessions (atelier_sid) issued at login and checked by authorize(). */
  sessions: {
    env: "SECURITY_SESSIONS_ENABLED",
    modes: ["off", "shadow", "enforce"],
  },
  /** I2: device registration at login + self-service device APIs. */
  deviceTrust: {
    env: "SECURITY_DEVICE_TRUST_ENABLED",
    modes: ["off", "detect", "enforce"],
  },
  /** I3: new-device verification (admin approval queue + APIs). */
  deviceVerification: {
    env: "SECURITY_DEVICE_VERIFICATION_ENABLED",
    modes: ["off", "on"],
  },
  /** I4: cross-device concurrent-session limit (NEWEST_WINS). */
  concurrency: {
    env: "SECURITY_CONCURRENCY_ENABLED",
    modes: ["off", "detect", "enforce"],
  },
  /**
   * I5: risk evaluation. `act` is accepted but downgraded to `log-only` until
   * restrictions (I6) exist; I5 only records assessments.
   */
  riskEngine: {
    env: "SECURITY_RISK_ENGINE_ENABLED",
    modes: ["off", "log-only", "act"],
  },
  /**
   * I6: enforce existing restrictions/review flags in authorize() (with
   * SECURITY_ACCESS_DECISION=enforce) and expose the admin restriction APIs.
   * Creating restrictions additionally needs SECURITY_RISK_ENGINE_ENABLED=act.
   */
  restrictions: {
    env: "SECURITY_RESTRICTIONS_ENABLED",
    modes: ["off", "on"],
  },
  /** Later phases (DB-backed rate limiting). Parsed now, not consumed in I1. */
  rateLimitDb: { env: "SECURITY_RATE_LIMIT_DB", modes: ["off", "on"] },
  /** Later phases (admin step-up). Parsed now, not consumed in I1. */
  adminStepUp: { env: "SECURITY_ADMIN_STEP_UP", modes: ["off", "on"] },
  /**
   * I5: read coarse country from Cloudflare's `cf-ipcountry` header. Only turn
   * on once the origin is provably reachable only through Cloudflare
   * (ADR-012); otherwise the header is client-controlled.
   */
  trustedGeoHeader: { env: "SECURITY_TRUST_PROXY_GEO", modes: ["off", "on"] },
  /** I7: Admin Security Center pages, APIs and administrative actions. */
  adminSecurityCenter: { env: "SECURITY_ADMIN_SECURITY_CENTER", modes: ["off", "on"] },
} as const;

export type SecurityFlagName = keyof typeof FLAG_DEFINITIONS;
export type SecurityFlagMode<K extends SecurityFlagName> =
  (typeof FLAG_DEFINITIONS)[K]["modes"][number];
export type SecurityFlags = { [K in SecurityFlagName]: SecurityFlagMode<K> };

export const EVICTION_POLICIES = ["NEWEST_WINS", "DENY_NEW", "STEP_UP"] as const;
export type EvictionPolicy = (typeof EVICTION_POLICIES)[number];

/** Approved business defaults (Biz-A). Overridable via env, never hard-coded elsewhere. */
export const DEFAULT_DEVICE_LIMIT = 3;
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 1;
export const DEFAULT_EVICTION_POLICY: EvictionPolicy = "NEWEST_WINS";

/** Bounds for device and session limits (config and per-customer admin overrides). */
export const LIMIT_BOUNDS = { min: 1, max: 10 } as const;

/** Approved retention defaults (G8 / ADR-019). */
export const RETENTION = {
  securityEventDays: 180,
  riskAssessmentDays: 180,
  revokedDeviceDays: 400,
  sessionMaxDays: REMEMBER_DAYS,
  adminActionMinDays: 730,
  otpChallengeMaxHours: 24,
} as const;

export const DEVICE_COOKIE_MAX_AGE_DAYS = 400;

/** Minimum gap between lastActivityAt / lastSeenAt writes (avoids a write per request). */
export const ACTIVITY_TOUCH_SECONDS = 60;

/**
 * Whether a complete new-device verification path exists (verifier, approval
 * and rejection, 24h expiry, customer waiting state, admin step-up, audit).
 * Enabled in I3 after that path was implemented and tested. Enforcement also
 * needs SECURITY_DEVICE_VERIFICATION_ENABLED=on, HTTPS and a cutover.
 */
export const DEVICE_VERIFICATION_AVAILABLE = true;

/** I3: a pending device must be approved within this window or it expires. */
export const PENDING_DEVICE_TTL_HOURS = 24;

/** I3: verification mechanisms. Only admin approval exists; email OTP comes later. */
export const DEVICE_VERIFIERS = ["admin-approval"] as const;
export type DeviceVerifierId = (typeof DEVICE_VERIFIERS)[number];

export type SecurityConfig = {
  flags: SecurityFlags;
  limits: {
    deviceLimit: number;
    maxConcurrentSessions: number;
    evictionPolicy: EvictionPolicy;
  };
  sessions: {
    defaultDays: number;
    rememberDays: number;
    /**
     * JWTs issued at/after this instant must present a valid server session
     * (atelier_sid). Older JWTs are legacy and keep working until they expire.
     */
    cutoverAt: Date | null;
    activityTouchSeconds: number;
  };
  device: {
    cookieMaxAgeDays: number;
    secureCookies: boolean;
    verificationAvailable: boolean;
    pendingTtlHours: number;
    verifier: DeviceVerifierId;
  };
  retention: typeof RETENTION;
  risk: RiskThresholds;
  restrictions: { highHours: number; criticalDays: number };
  warnings: string[];
};

/** I6 approved defaults: HIGH blocks 24 hours; CRITICAL blocks up to 7 days pending review. */
export const DEFAULT_RESTRICTION_HIGH_HOURS = 24;
export const DEFAULT_RESTRICTION_CRITICAL_DAYS = 7;

function boundedInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number, warnings: string[]) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (value >= 1 && value <= max) return value;
  }
  warnings.push(`${name} must be an integer 1-${max}; using ${fallback}`);
  return fallback;
}

function parseRestrictionDurations(env: NodeJS.ProcessEnv, warnings: string[]) {
  const highHours = boundedInt(env, "SECURITY_RESTRICTION_HIGH_HOURS", DEFAULT_RESTRICTION_HIGH_HOURS, 168, warnings);
  const criticalDays = boundedInt(env, "SECURITY_RESTRICTION_CRITICAL_DAYS", DEFAULT_RESTRICTION_CRITICAL_DAYS, 30, warnings);
  if (criticalDays * 24 < highHours) {
    warnings.push("SECURITY_RESTRICTION_CRITICAL_DAYS must not be shorter than the HIGH duration; using defaults");
    return { highHours: DEFAULT_RESTRICTION_HIGH_HOURS, criticalDays: DEFAULT_RESTRICTION_CRITICAL_DAYS };
  }
  return { highHours, criticalDays };
}

/**
 * I5 risk thresholds and time windows. Defaults are deliberately tolerant of
 * normal multi-device use (laptop + phone, home/office/mobile networks).
 * Override any subset with SECURITY_RISK_THRESHOLDS (JSON, validated).
 */
export const DEFAULT_RISK_THRESHOLDS = {
  /** Cross-device session evictions (NEWEST_WINS) within the window. */
  evictionWindowMinutes: 60,
  evictionCount: 3,
  /** Session starts on a different device than the previous start. */
  switchWindowHours: 24,
  switchCount: 8,
  /** A→B→A returns within the window. */
  pingPongWindowHours: 6,
  pingPongCount: 4,
  /** Distinct devices starting sessions within a short window. */
  burstWindowMinutes: 60,
  burstDeviceCount: 3,
  /** New device registrations (device churn). */
  churnWindowDays: 7,
  churnCount: 4,
  /** Rejected + expired device requests. */
  deniedDeviceWindowDays: 30,
  deniedDeviceCount: 2,
  /** Device limit reached at login. */
  limitWindowDays: 7,
  limitCount: 2,
  /** Session presented with another device's cookie. */
  mismatchWindowHours: 24,
  mismatchCount: 1,
  /** Wrong passwords for an existing account. */
  loginFailureWindowMinutes: 60,
  loginFailureCount: 5,
  /** Supporting only: distinct IP hashes across session starts. */
  networkWindowHours: 1,
  networkCount: 4,
  /** Supporting only: distinct countries across session starts. */
  geoWindowHours: 2,
  geoCount: 2,
  /** Score bands (sum of rule weights). */
  mediumScore: 20,
  highScore: 50,
  criticalScore: 80,
} as const;

export type RiskThresholds = { -readonly [K in keyof typeof DEFAULT_RISK_THRESHOLDS]: number };

/** Hard ceiling on how far back evaluation looks, whatever the config says. */
export const RISK_MAX_LOOKBACK_DAYS = 30;

function parseRiskThresholds(env: NodeJS.ProcessEnv, warnings: string[]): RiskThresholds {
  const thresholds: RiskThresholds = { ...DEFAULT_RISK_THRESHOLDS };
  const raw = env.SECURITY_RISK_THRESHOLDS?.trim();
  if (!raw) return thresholds;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("SECURITY_RISK_THRESHOLDS is not valid JSON; using defaults");
    return thresholds;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push("SECURITY_RISK_THRESHOLDS must be a JSON object; using defaults");
    return thresholds;
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in DEFAULT_RISK_THRESHOLDS)) {
      warnings.push(`SECURITY_RISK_THRESHOLDS: unknown key ${key.slice(0, 40)} ignored`);
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10_000) {
      warnings.push(`SECURITY_RISK_THRESHOLDS.${key} must be an integer 1-10000; using default`);
      continue;
    }
    thresholds[key as keyof RiskThresholds] = value;
  }
  const days = RISK_MAX_LOOKBACK_DAYS;
  if (thresholds.churnWindowDays > days) thresholds.churnWindowDays = days;
  if (thresholds.deniedDeviceWindowDays > days) thresholds.deniedDeviceWindowDays = days;
  if (thresholds.limitWindowDays > days) thresholds.limitWindowDays = days;
  if (!(thresholds.mediumScore < thresholds.highScore && thresholds.highScore < thresholds.criticalScore)) {
    warnings.push("SECURITY_RISK_THRESHOLDS score bands must increase; using default bands");
    thresholds.mediumScore = DEFAULT_RISK_THRESHOLDS.mediumScore;
    thresholds.highScore = DEFAULT_RISK_THRESHOLDS.highScore;
    thresholds.criticalScore = DEFAULT_RISK_THRESHOLDS.criticalScore;
  }
  return thresholds;
}

function parseVerifier(env: NodeJS.ProcessEnv, warnings: string[]): DeviceVerifierId {
  const raw = env.SECURITY_DEVICE_VERIFIER?.trim().toLowerCase();
  if (!raw) return "admin-approval";
  if ((DEVICE_VERIFIERS as readonly string[]).includes(raw)) return raw as DeviceVerifierId;
  warnings.push(
    `SECURITY_DEVICE_VERIFIER has unsupported value; using admin-approval (allowed: ${DEVICE_VERIFIERS.join(", ")})`,
  );
  return "admin-approval";
}

function parseCutover(env: NodeJS.ProcessEnv, warnings: string[]): Date | null {
  const raw = env.SECURITY_SESSIONS_CUTOVER_AT?.trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    warnings.push(
      "SECURITY_SESSIONS_CUTOVER_AT must be an ISO-8601 timestamp; ignoring it",
    );
    return null;
  }
  return date;
}

function parseFlag<K extends SecurityFlagName>(
  name: K,
  env: NodeJS.ProcessEnv,
  warnings: string[],
): SecurityFlagMode<K> {
  const def = FLAG_DEFINITIONS[name];
  const raw = env[def.env]?.trim().toLowerCase();
  const modes = def.modes as readonly string[];
  if (!raw) return "off" as SecurityFlagMode<K>;
  if (modes.includes(raw)) return raw as SecurityFlagMode<K>;
  warnings.push(
    `${def.env} has unsupported value; using "off" (allowed: ${modes.join(", ")})`,
  );
  return "off" as SecurityFlagMode<K>;
}

function parseLimit(
  envName: string,
  fallback: number,
  env: NodeJS.ProcessEnv,
  warnings: string[],
): number {
  const raw = env[envName]?.trim();
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (value >= LIMIT_BOUNDS.min && value <= LIMIT_BOUNDS.max) return value;
  }
  warnings.push(
    `${envName} must be an integer ${LIMIT_BOUNDS.min}-${LIMIT_BOUNDS.max}; using ${fallback}`,
  );
  return fallback;
}

function parseEvictionPolicy(
  env: NodeJS.ProcessEnv,
  warnings: string[],
): EvictionPolicy {
  const raw = env.SECURITY_EVICTION_POLICY?.trim().toUpperCase();
  if (!raw) return DEFAULT_EVICTION_POLICY;
  if ((EVICTION_POLICIES as readonly string[]).includes(raw)) {
    return raw as EvictionPolicy;
  }
  warnings.push(
    `SECURITY_EVICTION_POLICY has unsupported value; using ${DEFAULT_EVICTION_POLICY}`,
  );
  return DEFAULT_EVICTION_POLICY;
}

export function getSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): SecurityConfig {
  const warnings: string[] = [];
  const flags = {} as SecurityFlags;
  for (const name of Object.keys(FLAG_DEFINITIONS) as SecurityFlagName[]) {
    (flags as Record<SecurityFlagName, string>)[name] = parseFlag(
      name,
      env,
      warnings,
    );
  }

  const secureCookies = shouldUseSecureCookie(env);
  const cutoverAt = parseCutover(env, warnings);
  const verificationAvailable = DEVICE_VERIFICATION_AVAILABLE;

  if (flags.deviceTrust === "enforce") {
    // Every prerequisite must hold, otherwise pending devices could never be
    // approved (lockout) or the check could be bypassed.
    const missing: string[] = [];
    // ADR-012: device binding is only a real control over HTTPS.
    if (!secureCookies) missing.push("secure cookies (HTTPS)");
    if (!verificationAvailable) missing.push("the new-device verification implementation");
    if (flags.deviceVerification !== "on") {
      missing.push("SECURITY_DEVICE_VERIFICATION_ENABLED=on");
    }
    // Without a cutover, deleting the device cookie makes a new login look
    // like a pre-I2 one, which isn't device-checked.
    if (!cutoverAt) missing.push("SECURITY_SESSIONS_CUTOVER_AT");
    if (missing.length > 0) {
      flags.deviceTrust = "detect";
      warnings.push(
        `SECURITY_DEVICE_TRUST_ENABLED=enforce requires ${missing.join(", ")}; downgraded to detect`,
      );
    }
  }

  const evictionPolicy = parseEvictionPolicy(env, warnings);

  // Verification needs devices to verify.
  if (flags.deviceVerification === "on" && flags.deviceTrust === "off") {
    flags.deviceVerification = "off";
    warnings.push(
      "SECURITY_DEVICE_VERIFICATION_ENABLED requires SECURITY_DEVICE_TRUST_ENABLED (detect or enforce); using off",
    );
  }

  // Every server session is bound to a device, so sessions need device tracking.
  if (flags.sessions !== "off" && flags.deviceTrust === "off") {
    flags.sessions = "off";
    warnings.push(
      "SECURITY_SESSIONS_ENABLED requires SECURITY_DEVICE_TRUST_ENABLED (detect or enforce); using off",
    );
  }
  // Without a cutover, a stripped atelier_sid cookie would look like a legacy
  // (pre-I2) login, so enforcement would be bypassable.
  if (flags.sessions === "enforce" && !cutoverAt) {
    flags.sessions = "shadow";
    warnings.push(
      "SECURITY_SESSIONS_ENABLED=enforce requires SECURITY_SESSIONS_CUTOVER_AT; downgraded to shadow",
    );
  }

  // I4: the concurrent-session limit works on server sessions. Runs after the
  // session guards above, which may still downgrade sessions.
  if (flags.concurrency !== "off" && flags.sessions === "off") {
    flags.concurrency = "off";
    warnings.push(
      "SECURITY_CONCURRENCY_ENABLED requires SECURITY_SESSIONS_ENABLED (shadow or enforce); using off",
    );
  }
  if (flags.concurrency === "enforce") {
    const missing: string[] = [];
    // Evicting a session only matters if revoked sessions are actually refused.
    if (flags.sessions !== "enforce") missing.push("SECURITY_SESSIONS_ENABLED=enforce");
    // Only NEWEST_WINS is implemented (I4); DENY_NEW / STEP_UP are not.
    if (evictionPolicy !== "NEWEST_WINS") missing.push("SECURITY_EVICTION_POLICY=NEWEST_WINS");
    if (missing.length > 0) {
      flags.concurrency = "detect";
      warnings.push(
        `SECURITY_CONCURRENCY_ENABLED=enforce requires ${missing.join(", ")}; downgraded to detect`,
      );
    }
  }

  // I6: acting on risk creates restrictions, which only mean something if
  // restrictions are on and the access decision actually enforces them.
  if (flags.riskEngine === "act") {
    const missing: string[] = [];
    if (flags.restrictions !== "on") missing.push("SECURITY_RESTRICTIONS_ENABLED=on");
    if (flags.accessDecision !== "enforce") missing.push("SECURITY_ACCESS_DECISION=enforce");
    if (missing.length > 0) {
      flags.riskEngine = "log-only";
      warnings.push(
        `SECURITY_RISK_ENGINE_ENABLED=act requires ${missing.join(", ")}; downgraded to log-only`,
      );
    }
  }

  return {
    risk: parseRiskThresholds(env, warnings),
    restrictions: parseRestrictionDurations(env, warnings),
    flags,
    limits: {
      deviceLimit: parseLimit(
        "SECURITY_DEVICE_LIMIT",
        DEFAULT_DEVICE_LIMIT,
        env,
        warnings,
      ),
      maxConcurrentSessions: parseLimit(
        "SECURITY_MAX_CONCURRENT_SESSIONS",
        DEFAULT_MAX_CONCURRENT_SESSIONS,
        env,
        warnings,
      ),
      evictionPolicy,
    },
    sessions: {
      defaultDays: SESSION_DAYS,
      rememberDays: REMEMBER_DAYS,
      cutoverAt,
      activityTouchSeconds: ACTIVITY_TOUCH_SECONDS,
    },
    device: {
      cookieMaxAgeDays: DEVICE_COOKIE_MAX_AGE_DAYS,
      secureCookies,
      verificationAvailable,
      pendingTtlHours: PENDING_DEVICE_TTL_HOURS,
      verifier: parseVerifier(env, warnings),
    },
    retention: RETENTION,
    warnings,
  };
}
