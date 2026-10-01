import type { Db } from "mongodb";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { DEVICE_COOKIE, deviceCookieOptions, deviceReferenceCode } from "@/lib/security/device";
import { pendingDeadline, registerDevice } from "@/lib/security/device-registry";
import { getDeviceVerifier } from "@/lib/security/verifier";
import { startSessionWithConcurrency } from "@/lib/security/concurrency";
import { recordSecurityEvent } from "@/lib/security/events";
import {
  SESSION_ID_COOKIE,
  sessionCookieOptions,
  sessionRef,
} from "@/lib/security/session";

/**
 * Additive login step (I2). Runs only after the existing email + password +
 * bcrypt + isActive checks have passed, and only for customer accounts.
 *
 *   device cookie ─▶ resolve / register device (slot-limited, one-time auto-trust)
 *                ─▶ server session bound to that device (atelier_sid)
 *
 * It never changes the JWT. Unless sessions are enforced, a failure here
 * never blocks the login (fail-open + event).
 */

export type LoginSecurityInput = {
  userId: string;
  role: "USER" | "SUPER_ADMIN";
  rememberMe: boolean;
  deviceCookie?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  /** Country code from a trusted proxy header, or null. Supporting signal only. */
  coarseGeo?: string | null;
  now?: Date;
};

export type LoginSecurityResult =
  | { kind: "skipped" }
  | { kind: "device-limit" }
  | {
      kind: "ok";
      /** New raw device secret to set as the cookie, or null if unchanged. */
      deviceSecret: string | null;
      /** New raw session id for atelier_sid, or null if sessions are off. */
      sessionId: string | null;
      /**
       * Sessions are on but one couldn't be started. The device cookie is
       * still delivered so a retry reuses the device instead of orphaning a
       * slot.
       */
      sessionFailed: boolean;
      /** Set when this browser's device is waiting for verification. */
      pendingDevice: { referenceCode: string; expiresAt: string } | null;
    };

export async function applyLoginSecurity(
  db: Db,
  input: LoginSecurityInput,
  config: SecurityConfig = getSecurityConfig(),
): Promise<LoginSecurityResult> {
  if (input.role !== "USER" || config.flags.deviceTrust === "off") {
    return { kind: "skipped" };
  }
  const now = input.now ?? new Date();
  const base = {
    actorType: "USER" as const,
    actorId: input.userId,
    userId: input.userId,
    ip: input.ip,
    // I5: only set when SECURITY_TRUST_PROXY_GEO=on (see login route).
    ...(input.coarseGeo ? { coarseGeo: input.coarseGeo } : {}),
  };

  const registration = await registerDevice(
    db,
    { userId: input.userId, deviceCookie: input.deviceCookie, userAgent: input.userAgent, now },
    config,
  );

  if (registration.cookieRejected) {
    await recordSecurityEvent(db, {
      ...base,
      type: "DEVICE_COOKIE_REJECTED",
      reasonCodes: [`DEVICE_COOKIE_${registration.cookieRejected}`],
    });
  }

  if (registration.outcome === "LIMIT_REACHED") {
    await recordSecurityEvent(db, {
      ...base,
      type: "DEVICE_LIMIT_REACHED",
      reasonCodes: ["DEVICE_LIMIT_REACHED"],
      metadata: { deviceLimit: config.limits.deviceLimit },
    });
    return { kind: "device-limit" };
  }

  const device = registration.device;
  if (registration.outcome === "CREATED" && device.status === "PENDING_VERIFICATION") {
    // Mechanism-specific side effect (nothing for admin approval; would send a
    // code for a future email-OTP verifier). Never blocks the login.
    await getDeviceVerifier(config)
      .onPendingDevice(db, device)
      .catch(() => undefined);
  }
  if (registration.outcome === "CREATED") {
    await recordSecurityEvent(db, {
      ...base,
      type: "DEVICE_REGISTERED",
      deviceId: device._id,
      reasonCodes: [registration.enrolled ? "FIRST_DEVICE_AUTO_TRUSTED" : "PENDING_VERIFICATION"],
      metadata: {
        status: device.status,
        platform: device.platform,
        browserFamily: device.browserFamily,
      },
    });
  }

  let sessionId: string | null = null;
  let sessionFailed = false;
  if (config.flags.sessions !== "off") {
    const started = await startSessionWithConcurrency(
      db,
      { userId: input.userId, deviceId: device._id, rememberMe: input.rememberMe, now },
      config,
    ).catch(() => null);
    if (started) {
      sessionId = started.sessionId;
      const c = started.concurrency;
      // Session-switch signal for the I5 risk engine: which generation this
      // is and how many other-device sessions it pushed out.
      await recordSecurityEvent(db, {
        ...base,
        type: "SESSION_CREATED",
        deviceId: device._id,
        sessionRef: sessionRef(started.sessionId),
        metadata: {
          rememberMe: input.rememberMe,
          deviceStatus: device.status,
          concurrencyMode: c.mode,
          generation: c.generation,
          otherDeviceSessions: c.otherActiveBefore,
          evicted: c.mode === "enforce" ? c.evicted : 0,
          wouldEvict: c.mode === "detect" ? c.evicted : 0,
          selfEvicted: c.selfEvicted,
          pendingExempt: started.session.pendingExempt === true,
        },
      });
    } else {
      sessionFailed = true;
    }
  }

  return {
    kind: "ok",
    deviceSecret: registration.outcome === "CREATED" ? registration.secret : null,
    sessionId,
    sessionFailed,
    pendingDevice:
      device.status === "PENDING_VERIFICATION"
        ? {
            referenceCode: deviceReferenceCode(device._id),
            expiresAt: pendingDeadline(device, config).toISOString(),
          }
        : null,
  };
}

export type LoginGate = { status: 403 | 503; error: string } | null;

/**
 * Whether the login must be refused. Only when server sessions are enforced:
 * without a session the customer would be locked out right after logging in.
 */
export function loginSecurityGate(
  result: LoginSecurityResult | "error",
  config: SecurityConfig = getSecurityConfig(),
): LoginGate {
  if (config.flags.sessions !== "enforce") return null;
  if (result === "error" || (result.kind === "ok" && result.sessionFailed)) {
    return { status: 503, error: "Security check is temporarily unavailable. Please try again." };
  }
  if (result.kind === "device-limit") {
    return {
      status: 403,
      error:
        "This account has reached its device limit. Sign in on one of your existing devices to remove a device you no longer use, or contact your administrator.",
    };
  }
  return null;
}

type CookieJar = {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
};

export function setLoginSecurityCookies(
  jar: CookieJar,
  result: LoginSecurityResult | "error",
  rememberMe: boolean,
  config: SecurityConfig = getSecurityConfig(),
) {
  const ok = result !== "error" && result.kind === "ok" ? result : null;
  if (ok?.deviceSecret) {
    jar.set(DEVICE_COOKIE, ok.deviceSecret, deviceCookieOptions(config));
  }
  if (ok?.sessionId) {
    jar.set(SESSION_ID_COOKIE, ok.sessionId, sessionCookieOptions(rememberMe, config));
  } else if (config.flags.sessions !== "off") {
    // Never leave a previous login's session id next to the new JWT.
    jar.delete(SESSION_ID_COOKIE);
  }
}
