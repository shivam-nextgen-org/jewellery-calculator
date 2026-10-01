import { cookies } from "next/headers";
import { getApiKeySession } from "@/lib/auth/api-keys";
import { shouldUseSecureCookie } from "@/lib/auth/cookie-security";
import { AuthError } from "@/lib/auth/errors";
import {
  readSessionClaims,
  readSessionToken,
  REMEMBER_DAYS,
  SESSION_COOKIE,
  SESSION_DAYS,
  signSession,
  type SessionClaims,
  type SessionUser,
} from "@/lib/auth/token";
import { authorize, type AccessRequirement } from "@/lib/security/authorize";

export type { SessionUser };
export { SESSION_COOKIE, readSessionToken, signSession, AuthError };

async function getSessionClaims(): Promise<SessionClaims | null> {
  const jar = await cookies();
  return readSessionClaims(jar.get(SESSION_COOKIE)?.value);
}

export async function getSession(): Promise<SessionUser | null> {
  return (await getSessionClaims())?.user ?? null;
}

export async function createSession(user: SessionUser, remember = false) {
  const days = remember ? REMEMBER_DAYS : SESSION_DAYS;
  const token = await signSession(user, days);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: days * 24 * 60 * 60,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Existing checks run first and are unchanged. authorize() then applies the
 * central access decision; with SECURITY_ACCESS_DECISION=off (default) it
 * returns immediately without touching the database.
 */
export async function requireUser(): Promise<SessionUser> {
  const claims = await getSessionClaims();
  const session = claims?.user ?? null;
  if (session?.role === "USER") {
    await authorize(
      { kind: "SESSION", user: session, issuedAt: claims?.issuedAt ?? null },
      "USER",
    );
    return session;
  }
  const apiUser = await getApiKeySession();
  if (apiUser) {
    await authorize({ kind: "API_KEY", user: apiUser }, "USER");
    return apiUser;
  }
  throw new AuthError(
    session ? "Forbidden" : "Unauthorized",
    session ? 403 : 401,
  );
}

/**
 * Like requireUser, but only a customer's own browser session qualifies —
 * API keys are rejected. Used by the self-service device APIs.
 */
export async function requireCustomerSession(): Promise<SessionUser> {
  const claims = await getSessionClaims();
  if (!claims) throw new AuthError("Unauthorized", 401);
  if (claims.user.role !== "USER") throw new AuthError("Forbidden", 403);
  await authorize(
    { kind: "SESSION", user: claims.user, issuedAt: claims.issuedAt },
    "USER",
  );
  return claims.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const claims = await getSessionClaims();
  const session = claims?.user ?? null;
  if (!session || session.role !== "SUPER_ADMIN") {
    throw new AuthError(
      session ? "Forbidden" : "Unauthorized",
      session ? 403 : 401,
    );
  }
  await authorize(
    { kind: "SESSION", user: session, issuedAt: claims?.issuedAt ?? null },
    "ADMIN",
  );
  return session;
}

export type DeviceNotice =
  | { state: "PENDING"; referenceCode: string; expiresAt: string; title: string; instructions: string }
  | { state: "EXPIRED" | "REJECTED" | "REVOKED" | "SIGNED_IN_ELSEWHERE" }
  /** I6: temporary restriction. No risk details, only when it ends. */
  | { state: "RESTRICTED"; until: string | null; pendingReview: boolean };

async function restrictionNotice(userId: string): Promise<DeviceNotice> {
  try {
    const [{ getDb }, { getRestrictionState }] = await Promise.all([
      import("@/lib/mongo"),
      import("@/lib/security/restriction"),
    ]);
    const state = await getRestrictionState(await getDb(), userId);
    return {
      state: "RESTRICTED",
      until: state.expiresAt?.toISOString() ?? null,
      pendingReview: state.level === "CRITICAL",
    };
  } catch {
    return { state: "RESTRICTED", until: null, pendingReview: false };
  }
}

export type PageAccess =
  | { kind: "ok"; user: SessionUser }
  | { kind: "anonymous" }
  | { kind: "denied"; status: number; device?: DeviceNotice };

const DEVICE_DENIAL_CODES = new Set([
  "DEVICE_NOT_TRUSTED",
  "DEVICE_EXPIRED",
  "DEVICE_REVOKED",
]);

/** Customer-facing device state for the "waiting for approval" screen. */
async function deviceNotice(userId: string): Promise<DeviceNotice | undefined> {
  try {
    const [{ getDb }, { customerDeviceState }, { getDeviceVerifier }, { DEVICE_COOKIE }, config] =
      await Promise.all([
        import("@/lib/mongo"),
        import("@/lib/security/device-verification"),
        import("@/lib/security/verifier"),
        import("@/lib/security/device"),
        import("@/lib/security/config").then((m) => m.getSecurityConfig()),
      ]);
    const jar = await cookies();
    const state = await customerDeviceState(
      await getDb(),
      userId,
      jar.get(DEVICE_COOKIE)?.value,
      new Date(),
      config,
    );
    if (state.state === "PENDING") {
      return { ...state, ...getDeviceVerifier(config).customerState() };
    }
    if (state.state === "EXPIRED" || state.state === "REJECTED" || state.state === "REVOKED") {
      return { state: state.state };
    }
  } catch {
    // Fall back to the generic notice.
  }
  return undefined;
}

/**
 * Guard for server components that read protected data (ADR-011 / G1).
 * Returns instead of throwing so pages can render their own state:
 * anonymous visitors keep the page's existing behaviour, and a denied
 * customer sees an "access restricted" notice. (A redirect to /login would
 * loop, because middleware sends signed-in users back to their home page.)
 */
export async function getPageAccess(
  requirement: AccessRequirement,
): Promise<PageAccess> {
  const claims = await getSessionClaims();
  if (!claims) return { kind: "anonymous" };
  const needRole = requirement === "ADMIN" ? "SUPER_ADMIN" : "USER";
  if (claims.user.role !== needRole) return { kind: "denied", status: 403 };
  try {
    await authorize(
      { kind: "SESSION", user: claims.user, issuedAt: claims.issuedAt },
      requirement,
    );
    return { kind: "ok", user: claims.user };
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // A device decision also ends the device's session, so the denial may be
    // reported as SESSION_REVOKED; the device state decides what to show.
    const device: DeviceNotice | undefined =
      requirement === "USER" && error.code === "ACCOUNT_TEMPORARILY_RESTRICTED"
        ? await restrictionNotice(claims.user.id)
        : requirement === "USER" && error.code === "SESSION_EVICTED"
        ? { state: "SIGNED_IN_ELSEWHERE" }
        : requirement === "USER" &&
            (error.status === 401 || (error.code && DEVICE_DENIAL_CODES.has(error.code)))
          ? await deviceNotice(claims.user.id)
          : undefined;
    return { kind: "denied", status: error.status, ...(device ? { device } : {}) };
  }
}
