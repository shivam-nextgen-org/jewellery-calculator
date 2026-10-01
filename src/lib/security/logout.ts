import type { Db } from "mongodb";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { recordSecurityEvent } from "@/lib/security/events";
import { lookupSession, revokeSession, SESSION_ID_COOKIE, sessionRef } from "@/lib/security/session";

type CookieJar = {
  get(name: string): { value: string } | undefined;
  delete(name: string): unknown;
};

/**
 * Revokes the presented server session and removes atelier_sid. The device
 * cookie is kept: logging out doesn't make a browser a new device.
 * Never throws — logout must always succeed.
 */
export async function revokeSessionOnLogout(
  jar: CookieJar,
  config: SecurityConfig = getSecurityConfig(),
  getDb?: () => Promise<Db>,
): Promise<void> {
  const sid = jar.get(SESSION_ID_COOKIE)?.value;
  if (!sid) return;
  jar.delete(SESSION_ID_COOKIE);
  if (config.flags.sessions === "off") return;
  try {
    const db = getDb ? await getDb() : await (await import("@/lib/mongo")).getDb();
    const state = await lookupSession(db, sid);
    if (await revokeSession(db, sid, "LOGOUT")) {
      const userId = state.state === "VALID" ? state.session.userId : null;
      await recordSecurityEvent(db, {
        type: "SESSION_REVOKED",
        actorType: "USER",
        actorId: userId,
        userId,
        deviceId: state.state === "VALID" ? state.session.deviceId : null,
        sessionRef: sessionRef(sid),
        reasonCodes: ["LOGOUT"],
      });
    }
  } catch {
    // The cookie is already gone; the session still expires on its own.
  }
}
