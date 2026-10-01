import type { Db, ObjectId } from "mongodb";
import type { DeviceCheck, SessionCheck } from "@/lib/security/authorize";
import type { SessionDoc } from "@/lib/security/collections";
import type { SecurityConfig } from "@/lib/security/config";
import { isEvictedByNewerSession } from "@/lib/security/concurrency";
import { findDeviceBySecret, TERMINAL_DEVICE_STATUSES } from "@/lib/security/device";
import { isPendingExpired } from "@/lib/security/device-registry";
import { requireObjectId } from "@/lib/security/ids";
import { isEndedByForceLogout, lookupSession, sessionRef, touchSession } from "@/lib/security/session";

/**
 * Resolves the session and device inputs for decideAccess() (I2).
 *
 * Session transport (Option B): the opaque session id travels in the
 * HttpOnly `atelier_sid` cookie; the JWT is unchanged. To stop someone from
 * deleting `atelier_sid` so a new login looks like a pre-I2 one, any JWT
 * issued at/after `SECURITY_SESSIONS_CUTOVER_AT` MUST come with a valid
 * session. JWTs issued before the cutover are legacy and are not
 * session-checked (grace) until they expire (<= 30 days).
 */

export type PresentedSecurityCookies = {
  sid?: string | null;
  device?: string | null;
};

export type SecurityContext = {
  session: SessionCheck;
  device: DeviceCheck;
  /** Log-safe reference of the presented session, if any. */
  sessionRef: string | null;
  deviceId: ObjectId | null;
};

export type SecurityContextInput = {
  userId: string;
  issuedAt: Date | null;
  cookies: PresentedSecurityCookies;
};

export function isLegacyToken(issuedAt: Date | null, config: SecurityConfig): boolean {
  const cutover = config.sessions.cutoverAt;
  if (!cutover) return true;
  if (!issuedAt) return true;
  return issuedAt.getTime() < cutover.getTime();
}

const NONE: SecurityContext = {
  session: "NOT_EVALUATED",
  device: "NOT_EVALUATED",
  sessionRef: null,
  deviceId: null,
};

export async function evaluateSecurityContext(
  db: Db,
  input: SecurityContextInput,
  config: SecurityConfig,
  now: Date = new Date(),
): Promise<SecurityContext> {
  const sessionsOn = config.flags.sessions !== "off";
  const devicesOn = config.flags.deviceTrust !== "off";
  if (!sessionsOn && !devicesOn) return NONE;

  const userId = requireObjectId(input.userId, "userId");
  const legacy = isLegacyToken(input.issuedAt, config);
  const result: SecurityContext = { ...NONE };
  let session: SessionDoc | null = null;

  if (sessionsOn) {
    const sid = input.cookies.sid;
    if (sid) {
      result.sessionRef = typeof sid === "string" && sid.length < 100 ? sessionRef(sid) : null;
      const state = await lookupSession(db, sid, now);
      if (state.state === "VALID") {
        if (state.session.userId.equals(userId)) {
          if (await isEndedByForceLogout(db, state.session, now)) {
            // I7: an admin force logout covers sessions created up to that
            // moment, including a login that was still in flight.
            result.session = "REVOKED";
          } else if (await isEvictedByNewerSession(db, state.session, config, now)) {
            // NEWEST_WINS: a newer session on another device took over.
            result.session = "EVICTED";
          } else {
            session = state.session;
            result.session = "VALID";
            await touchSession(db, session, now, config);
          }
        } else {
          // Someone else's session next to this user's JWT.
          result.session = "NOT_FOUND";
        }
      } else if (
        state.state === "REVOKED" &&
        state.session.revokedReason === "EVICTED" &&
        state.session.userId.equals(userId)
      ) {
        result.session = "EVICTED";
      } else {
        result.session = state.state;
      }
    } else {
      result.session = legacy ? "NOT_EVALUATED" : "NOT_FOUND";
    }
  }

  if (devicesOn) {
    const deviceCookie = input.cookies.device;
    if (!deviceCookie && legacy && !session) {
      // Pre-cutover login that never went through device registration.
      result.device = "NOT_EVALUATED";
    } else {
      const device = await findDeviceBySecret(db, deviceCookie);
      if (!device) {
        result.device = "MISSING";
      } else if (!device.userId.equals(userId)) {
        result.device = "MISMATCH";
      } else if (
        TERMINAL_DEVICE_STATUSES.includes(device.status) ||
        isPendingExpired(device, now, config)
      ) {
        // Expired (including a pending request past its 24h deadline that the
        // sweep hasn't reached yet) or revoked/rejected: never usable.
        result.device = device.status === "REVOKED" ? "REVOKED" : "EXPIRED";
        result.deviceId = device._id;
        if (session && session.deviceId.equals(device._id)) result.session = "REVOKED";
      } else if (session && !session.deviceId.equals(device._id)) {
        result.device = "MISMATCH";
        result.deviceId = device._id;
      } else {
        result.deviceId = device._id;
        result.device = device.status === "TRUSTED" ? "MATCH" : "UNTRUSTED";
      }
    }
  }

  return result;
}
