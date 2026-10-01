import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { evaluateSecurityContext, isLegacyToken } from "@/lib/security/context";
import { registerDevice, revokeDevice } from "@/lib/security/device-registry";
import { ensureIndexes } from "@/lib/security/indexes";
import {
  lookupSession,
  sessionCookieOptions,
  startDeviceSession,
} from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const CUTOVER = "2026-09-01T00:00:00Z";
const env = (values: Record<string, string> = {}) =>
  ({
    NODE_ENV: "test",
    SECURITY_DEVICE_TRUST_ENABLED: "detect",
    SECURITY_SESSIONS_ENABLED: "shadow",
    SECURITY_SESSIONS_CUTOVER_AT: CUTOVER,
    ...values,
  }) as NodeJS.ProcessEnv;
const config = getSecurityConfig(env());
const AFTER = new Date("2026-09-15T00:00:00Z");
const BEFORE = new Date("2026-08-15T00:00:00Z");

describe("session ↔ device binding (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: ObjectId;

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId();
  });

  async function newDevice(user = userId) {
    const result = await registerDevice(mem.db, { userId: user }, config);
    if (result.outcome !== "CREATED") throw new Error("expected CREATED");
    return result;
  }

  describe("startDeviceSession", () => {
    it("creates a session with the correct user, device and timestamps", async () => {
      const { device } = await newDevice();
      const now = new Date("2026-09-10T08:00:00Z");
      const started = await startDeviceSession(
        mem.db,
        { userId, deviceId: device._id, rememberMe: true, now },
        config,
      );
      expect(started?.session).toMatchObject({
        userId,
        deviceId: device._id,
        status: "ACTIVE",
        createdAt: now,
        lastActivityAt: now,
        revokedAt: null,
      });
      expect(started!.session.expiresAt.getTime() - now.getTime()).toBe(30 * 86_400_000);
    });

    it("replaces the device's previous session, leaving other devices alone", async () => {
      const a = await newDevice();
      const b = await newDevice();
      const first = await startDeviceSession(mem.db, { userId, deviceId: a.device._id }, config);
      const other = await startDeviceSession(mem.db, { userId, deviceId: b.device._id }, config);
      const second = await startDeviceSession(mem.db, { userId, deviceId: a.device._id }, config);

      const replaced = await lookupSession(mem.db, first!.sessionId);
      expect(replaced.state).toBe("REVOKED");
      if (replaced.state === "REVOKED") expect(replaced.session.revokedReason).toBe("REPLACED");
      expect((await lookupSession(mem.db, second!.sessionId)).state).toBe("VALID");
      // Not the concurrent-session limit (I4): the other device keeps its session.
      expect((await lookupSession(mem.db, other!.sessionId)).state).toBe("VALID");
    });

    it("keeps one active session per device under concurrent logins", async () => {
      const { device } = await newDevice();
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          startDeviceSession(mem.db, { userId, deviceId: device._id }, config),
        ),
      );
      expect(results.some((r) => r.status === "fulfilled" && r.value)).toBe(true);
      const active = await mem.db
        .collection("SecuritySession")
        .countDocuments({ deviceId: device._id, status: "ACTIVE" });
      expect(active).toBe(1);
    });

    it("refuses another user's device and revoked devices", async () => {
      const theirs = await newDevice(new ObjectId());
      expect(
        await startDeviceSession(mem.db, { userId, deviceId: theirs.device._id }, config),
      ).toBeNull();

      const mine = await newDevice();
      await revokeDevice(mem.db, userId, mine.device._id);
      expect(
        await startDeviceSession(mem.db, { userId, deviceId: mine.device._id }, config),
      ).toBeNull();
      expect(await mem.db.collection("SecuritySession").countDocuments()).toBe(0);
    });

    it("sets the session cookie with the approved properties", () => {
      const prod = getSecurityConfig(env({ NODE_ENV: "production" }));
      expect(sessionCookieOptions(false, prod)).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86_400,
      });
      expect(sessionCookieOptions(true, prod).maxAge).toBe(30 * 86_400);
    });
  });

  describe("evaluateSecurityContext", () => {
    async function trustedSession() {
      const reg = await newDevice();
      const started = await startDeviceSession(mem.db, { userId, deviceId: reg.device._id }, config);
      return { secret: reg.secret, deviceId: reg.device._id, sid: started!.sessionId };
    }

    const evaluate = (
      cookies: { sid?: string | null; device?: string | null },
      issuedAt: Date | null = AFTER,
      cfg: SecurityConfig = config,
      user = userId,
    ) =>
      evaluateSecurityContext(mem.db, { userId: user.toHexString(), issuedAt, cookies }, cfg);

    it("matches a valid session on its own trusted device", async () => {
      const t = await trustedSession();
      expect(await evaluate({ sid: t.sid, device: t.secret })).toMatchObject({
        session: "VALID",
        device: "MATCH",
        deviceId: t.deviceId,
      });
    });

    it("requires a session for post-cutover JWTs (stripped atelier_sid)", async () => {
      const t = await trustedSession();
      expect((await evaluate({ device: t.secret }, AFTER)).session).toBe("NOT_FOUND");
    });

    it("gives pre-cutover (legacy) JWTs a grace period", async () => {
      expect(await evaluate({}, BEFORE)).toMatchObject({
        session: "NOT_EVALUATED",
        device: "NOT_EVALUATED",
      });
      expect(isLegacyToken(BEFORE, config)).toBe(true);
      expect(isLegacyToken(AFTER, config)).toBe(false);
      expect(isLegacyToken(null, config)).toBe(true);
    });

    it("treats every JWT as legacy while no cutover is configured", async () => {
      const noCutover = getSecurityConfig(env({ SECURITY_SESSIONS_CUTOVER_AT: "" }));
      expect((await evaluate({}, AFTER, noCutover)).session).toBe("NOT_EVALUATED");
    });

    it("rejects a session presented with a different device's cookie", async () => {
      const t = await trustedSession();
      const other = await newDevice();
      expect(await evaluate({ sid: t.sid, device: other.secret })).toMatchObject({
        session: "VALID",
        device: "MISMATCH",
      });
    });

    it("rejects another user's session next to this user's JWT", async () => {
      const t = await trustedSession();
      expect((await evaluate({ sid: t.sid, device: t.secret }, AFTER, config, new ObjectId())).session).toBe(
        "NOT_FOUND",
      );
    });

    it("treats a revoked device's session as revoked", async () => {
      const t = await trustedSession();
      await revokeDevice(mem.db, userId, t.deviceId);
      expect(await evaluate({ sid: t.sid, device: t.secret })).toMatchObject({
        session: "REVOKED",
        device: "REVOKED",
      });
    });

    it("reports pending devices as untrusted and missing/garbage cookies as missing", async () => {
      await trustedSession(); // uses the one-time enrollment
      const pending = await newDevice();
      const s = await startDeviceSession(mem.db, { userId, deviceId: pending.device._id }, config);
      expect((await evaluate({ sid: s!.sessionId, device: pending.secret })).device).toBe("UNTRUSTED");
      expect((await evaluate({ sid: s!.sessionId, device: "garbage" })).device).toBe("MISSING");
      expect((await evaluate({ sid: "garbage" })).session).toBe("NOT_FOUND");
    });

    it("does nothing (no DB access) when both flags are off", async () => {
      const off = getSecurityConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
      const result = await evaluateSecurityContext(
        null as never, // would throw if touched
        { userId: userId.toHexString(), issuedAt: AFTER, cookies: { sid: "x" } },
        off,
      );
      expect(result).toMatchObject({ session: "NOT_EVALUATED", device: "NOT_EVALUATED" });
    });
  });
});
