import type { Db } from "mongodb";
import { AuthError } from "@/lib/auth/errors";
import type { SessionUser } from "@/lib/auth/token";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { evaluateSecurityContext, type SecurityContext } from "@/lib/security/context";
import { DEVICE_COOKIE } from "@/lib/security/device";
import { SECURITY_COLLECTIONS, type SecurityAccountDoc } from "@/lib/security/collections";
import { recordSecurityEvent, type SecurityEventInput } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";
import { SESSION_ID_COOKIE } from "@/lib/security/session";

/**
 * Access Decision foundation (ADR-010 / ADR-011).
 *
 * `decideAccess()` is the single, pure place where an access decision is
 * made. It already understands every input the target architecture needs
 * (account/access status, session, device, restriction) so later phases only
 * have to supply those inputs — not add new checks elsewhere.
 *
 * The runtime resolver supplies the live account state (existing
 * `User.isActive` + `role`) and, since I2, the session (atelier_sid) and
 * device (atelier_device) checks for customer browser sessions.
 *
 * Rollout is controlled by SECURITY_ACCESS_DECISION:
 *   off     → no DB read, no behaviour change (default)
 *   shadow  → evaluate + record ACCESS_WOULD_DENY, never block
 *   enforce → deny with the decided status
 */

export type AccessRequirement = "USER" | "ADMIN";
export type PrincipalKind = "SESSION" | "API_KEY";

export type Principal = {
  kind: PrincipalKind;
  user: SessionUser;
  /** JWT `iat`, used for the session cutover rule. */
  issuedAt?: Date | null;
};

/** Mirrors the approved License/account status model (doc 04 §8). */
export const ACCOUNT_STATUSES = [
  "ACTIVE",
  "REVIEW_REQUIRED",
  "TEMPORARILY_RESTRICTED",
  "SUSPENDED",
  "REVOKED",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type AccountState =
  | { state: "FOUND"; role: SessionUser["role"]; status: AccountStatus }
  | { state: "NOT_FOUND" }
  | { state: "UNAVAILABLE" };

export type SessionCheck =
  | "NOT_EVALUATED"
  | "VALID"
  | "NOT_FOUND"
  | "EXPIRED"
  | "REVOKED"
  | "EVICTED"
  | "UNAVAILABLE";

export type DeviceCheck =
  | "NOT_EVALUATED"
  | "MATCH"
  | "MISMATCH"
  | "UNTRUSTED"
  | "MISSING"
  | "REVOKED"
  | "EXPIRED"
  | "UNAVAILABLE";

export type AccessInput = {
  requirement: AccessRequirement;
  principal: Principal | null;
  account: AccountState;
  session?: SessionCheck;
  device?: DeviceCheck;
};

export type AccessDecision = {
  allow: boolean;
  /** HTTP status to use when denying (200 when allowed). */
  status: 200 | 401 | 403 | 503;
  reasons: string[];
};

const allow = (reasons: string[] = []): AccessDecision => ({
  allow: true,
  status: 200,
  reasons,
});
const deny = (
  status: AccessDecision["status"],
  reason: string,
): AccessDecision => ({ allow: false, status, reasons: [reason] });

/** Pure, ordered decision. First failing check wins. */
export function decideAccess(input: AccessInput): AccessDecision {
  const { requirement, principal, account } = input;

  // 1. Authentication
  if (!principal) return deny(401, "UNAUTHENTICATED");

  // 2. Role required by the route
  const needRole = requirement === "ADMIN" ? "SUPER_ADMIN" : "USER";
  if (principal.user.role !== needRole) return deny(403, "ROLE_NOT_PERMITTED");
  if (requirement === "ADMIN" && principal.kind !== "SESSION") {
    return deny(403, "ROLE_NOT_PERMITTED");
  }

  // 3. Live account state (the token's claims are not trusted on their own)
  if (account.state === "UNAVAILABLE") {
    return deny(503, "ACCOUNT_STATE_UNAVAILABLE");
  }
  if (account.state === "NOT_FOUND") return deny(401, "ACCOUNT_NOT_FOUND");
  if (account.role !== principal.user.role) return deny(403, "ROLE_CHANGED");

  // 4. Account / access status (restriction model)
  switch (account.status) {
    case "REVOKED":
      return deny(403, "ACCESS_REVOKED");
    case "SUSPENDED":
      return deny(403, "ACCOUNT_SUSPENDED");
    case "TEMPORARILY_RESTRICTED":
      return deny(403, "ACCOUNT_TEMPORARILY_RESTRICTED");
    case "REVIEW_REQUIRED":
    case "ACTIVE":
      break;
  }

  // 5. Server session (only once sessions are issued)
  switch (input.session ?? "NOT_EVALUATED") {
    case "NOT_FOUND":
      return deny(401, "SESSION_NOT_FOUND");
    case "EXPIRED":
      return deny(401, "SESSION_EXPIRED");
    case "REVOKED":
      return deny(401, "SESSION_REVOKED");
    case "EVICTED":
      return deny(401, "SESSION_EVICTED");
    case "UNAVAILABLE":
      return deny(503, "SESSION_STATE_UNAVAILABLE");
    case "VALID":
    case "NOT_EVALUATED":
      break;
  }

  // 6. Device binding (ADR-012)
  switch (input.device ?? "NOT_EVALUATED") {
    case "MISMATCH":
      return deny(401, "SESSION_DEVICE_MISMATCH");
    case "REVOKED":
      return deny(401, "DEVICE_REVOKED");
    case "EXPIRED":
      return deny(401, "DEVICE_EXPIRED");
    case "UNTRUSTED":
      return deny(401, "DEVICE_NOT_TRUSTED");
    case "MISSING":
      return deny(401, "DEVICE_MISSING");
    case "UNAVAILABLE":
      return deny(503, "DEVICE_STATE_UNAVAILABLE");
    case "MATCH":
    case "NOT_EVALUATED":
      break;
  }

  return allow(account.status === "REVIEW_REQUIRED" ? ["REVIEW_REQUIRED"] : []);
}

/** Maps the existing user document onto the account-status model. */
export function accountStateFromUser(
  user: { role?: unknown; isActive?: unknown } | null,
  security?: {
    restriction?: { expiresAt: Date } | null;
    review?: unknown;
  } | null,
  now: Date = new Date(),
): AccountState {
  if (!user) return { state: "NOT_FOUND" };
  if (user.role !== "SUPER_ADMIN" && user.role !== "USER") {
    return { state: "NOT_FOUND" };
  }
  // Admin "disable" (isActive=false) always wins and maps to SUSPENDED.
  if (user.isActive !== true) return { state: "FOUND", role: user.role, status: "SUSPENDED" };
  // I6: temporary restriction / review flag (customers only; passed only
  // when SECURITY_RESTRICTIONS_ENABLED=on). Expiry is checked here, so an
  // expired restriction stops blocking immediately.
  if (user.role === "USER" && security) {
    const r = security.restriction;
    if (r && r.expiresAt.getTime() > now.getTime()) {
      return { state: "FOUND", role: user.role, status: "TEMPORARILY_RESTRICTED" };
    }
    if (security.review) return { state: "FOUND", role: user.role, status: "REVIEW_REQUIRED" };
  }
  return { state: "FOUND", role: user.role, status: "ACTIVE" };
}

export type AuthorizeDeps = {
  loadAccount: (userId: string, config: SecurityConfig) => Promise<AccountState>;
  /** Session + device inputs for customer browser sessions. Must not throw. */
  loadContext: (principal: Principal, config: SecurityConfig) => Promise<SecurityContext>;
  recordEvent: (event: SecurityEventInput) => Promise<unknown>;
  config: SecurityConfig;
};

const UNAVAILABLE_CONTEXT: SecurityContext = {
  session: "UNAVAILABLE",
  device: "UNAVAILABLE",
  sessionRef: null,
  deviceId: null,
};

async function importDb(): Promise<Db> {
  const { getDb } = await import("@/lib/mongo");
  return getDb();
}

function defaultDeps(): AuthorizeDeps {
  // One DB handle per authorize() call, shared by the parallel lookups.
  let dbPromise: Promise<Db> | null = null;
  const defaultDb = () => (dbPromise ??= importDb());
  return {
    config: getSecurityConfig(),
    async loadAccount(userId, config) {
      const id = parseObjectId(userId);
      if (!id) return { state: "NOT_FOUND" };
      try {
        const db = await defaultDb();
        const restrictionsOn = config.flags.restrictions === "on";
        const [user, security] = await Promise.all([
          db
            .collection<{ role?: unknown; isActive?: unknown }>("User")
            .findOne({ _id: id }, { projection: { role: 1, isActive: 1 } }),
          restrictionsOn
            ? db
                .collection<SecurityAccountDoc>(SECURITY_COLLECTIONS.account)
                .findOne({ _id: id }, { projection: { restriction: 1, review: 1 } })
            : Promise.resolve(null),
        ]);
        const now = new Date();
        if (security?.restriction && security.restriction.expiresAt.getTime() <= now.getTime()) {
          // Already not blocking; tidy up the record after the response.
          const { runAfterResponse } = await import("@/lib/security/background");
          const { settleExpiredRestriction } = await import("@/lib/security/restriction");
          runAfterResponse(async () => {
            await settleExpiredRestriction(db, id, new Date());
          });
        }
        return accountStateFromUser(user, restrictionsOn ? (security ?? {}) : null, now);
      } catch {
        return { state: "UNAVAILABLE" };
      }
    },
    async loadContext(principal, config) {
      try {
        const [{ cookies }, db] = await Promise.all([
          import("next/headers"),
          defaultDb(),
        ]);
        const jar = await cookies();
        return await evaluateSecurityContext(
          db,
          {
            userId: principal.user.id,
            issuedAt: principal.issuedAt ?? null,
            cookies: {
              sid: jar.get(SESSION_ID_COOKIE)?.value ?? null,
              device: jar.get(DEVICE_COOKIE)?.value ?? null,
            },
          },
          config,
        );
      } catch {
        // Only blocks if the component is enforced (fail closed there).
        return UNAVAILABLE_CONTEXT;
      }
    },
    async recordEvent(event) {
      try {
        return await recordSecurityEvent(await defaultDb(), event);
      } catch {
        return false;
      }
    },
  };
}

export type AuthorizeResult = {
  mode: SecurityConfig["flags"]["accessDecision"];
  /** Full decision including components still in shadow/detect. */
  decision: AccessDecision | null;
};

/** Session/device checks apply only to customer browser sessions in I2. */
function tracksDevice(principal: Principal): boolean {
  return principal.kind === "SESSION" && principal.user.role === "USER";
}

/**
 * Runs the access decision for an already-authenticated principal.
 *
 * SECURITY_ACCESS_DECISION is the master switch. Within it, the account check
 * is always part of the decision, while the session and device checks only
 * block when their own flag is `enforce`; in shadow/detect they are evaluated
 * and recorded as ACCESS_WOULD_DENY. Throws AuthError only when blocking.
 */
export async function authorize(
  principal: Principal,
  requirement: AccessRequirement,
  deps: Partial<AuthorizeDeps> = {},
): Promise<AuthorizeResult> {
  const config = deps.config ?? getSecurityConfig();
  const mode = config.flags.accessDecision;
  if (mode === "off") return { mode, decision: null };

  const resolved = { ...defaultDeps(), ...deps, config };
  let full: AccessDecision;
  let enforced: AccessDecision;
  try {
    const [account, context] = await Promise.all([
      resolved.loadAccount(principal.user.id, config),
      tracksDevice(principal)
        ? resolved.loadContext(principal, config)
        : Promise.resolve(null),
    ]);
    const session = context?.session ?? "NOT_EVALUATED";
    const device = context?.device ?? "NOT_EVALUATED";
    full = decideAccess({ requirement, principal, account, session, device });
    enforced = decideAccess({
      requirement,
      principal,
      account,
      session: config.flags.sessions === "enforce" ? session : "NOT_EVALUATED",
      device: config.flags.deviceTrust === "enforce" ? device : "NOT_EVALUATED",
    });
  } catch {
    full = deny(503, "ACCESS_DECISION_ERROR");
    enforced = full;
  }

  const block = mode === "enforce" && !enforced.allow;
  if (!full.allow) {
    const actorType =
      principal.kind === "API_KEY"
        ? "API_KEY"
        : principal.user.role === "SUPER_ADMIN"
          ? "ADMIN"
          : "USER";
    const reasons = block ? enforced.reasons : full.reasons;
    const events: SecurityEventInput[] = [
      {
        type: block ? "ACCESS_DENIED" : "ACCESS_WOULD_DENY",
        actorType,
        actorId: principal.user.id,
        userId: principal.user.id,
        reasonCodes: reasons,
        metadata: { requirement, status: block ? enforced.status : full.status },
      },
    ];
    if (full.reasons.includes("SESSION_DEVICE_MISMATCH")) {
      events.push({
        type: "SESSION_DEVICE_MISMATCH",
        actorType,
        actorId: principal.user.id,
        userId: principal.user.id,
        reasonCodes: ["SESSION_DEVICE_MISMATCH"],
        metadata: { blocked: block },
      });
    }
    // Event recording is fail-open: it must never change the outcome.
    for (const event of events) {
      await Promise.resolve()
        .then(() => resolved.recordEvent(event))
        .catch(() => undefined);
    }
  }
  if (block) {
    throw new AuthError(
      enforced.status === 503
        ? "Service unavailable"
        : enforced.status === 401
          ? "Unauthorized"
          : "Forbidden",
      enforced.status,
      enforced.reasons[0],
    );
  }
  return { mode, decision: full };
}
