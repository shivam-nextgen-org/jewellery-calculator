import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimSessionGeneration,
  isEvictedByNewerSession,
  isWithinLimit,
  startSessionWithConcurrency,
} from "@/lib/security/concurrency";
import { getSecurityConfig, type SecurityConfig } from "@/lib/security/config";
import { evaluateSecurityContext } from "@/lib/security/context";
import { registerDevice, revokeDevice } from "@/lib/security/device-registry";
import {
  rejectPendingDevice,
  trustPendingDevice,
} from "@/lib/security/device-verification";
import { ensureIndexes } from "@/lib/security/indexes";
import { lookupSession } from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const base = {
  NODE_ENV: "test",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "enforce",
  SECURITY_SESSIONS_CUTOVER_AT: "2026-01-01T00:00:00Z",
  SECURITY_DEVICE_LIMIT: "10",
};
const cfg = (values: Record<string, string> = {}) =>
  getSecurityConfig({ ...base, ...values } as NodeJS.ProcessEnv);
const ENFORCE = cfg({ SECURITY_CONCURRENCY_ENABLED: "enforce" });
const DETECT = cfg({ SECURITY_CONCURRENCY_ENABLED: "detect" });
const OFF = cfg();
const DEVICE_ENFORCE = cfg({
  SECURITY_CONCURRENCY_ENABLED: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "enforce",
  SECURITY_DEVICE_VERIFICATION_ENABLED: "on",
  COOKIE_SECURE: "true",
});
const AFTER_CUTOVER = new Date("2026-06-01T00:00:00Z");

describe("isWithinLimit (pure)", () => {
  it("a session survives while fewer than `max` newer sessions are active", () => {
    expect(isWithinLimit(0, 1)).toBe(true);
    expect(isWithinLimit(1, 1)).toBe(false);
    expect(isWithinLimit(1, 2)).toBe(true);
    expect(isWithinLimit(2, 2)).toBe(false);
  });
});

describe("concurrent-session limit (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: ObjectId;
  const sessions = () => mem.db.collection("SecuritySession");
  const events = () => mem.db.collection("SecurityEvent");

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId();
  });

  /** Registers a device. The first is auto-trusted; later ones are pending. */
  async function device(config: SecurityConfig = ENFORCE) {
    const r = await registerDevice(mem.db, { userId }, config);
    if (r.outcome !== "CREATED") throw new Error("expected CREATED");
    return r;
  }
  const login = (deviceId: ObjectId, config: SecurityConfig = ENFORCE) =>
    startSessionWithConcurrency(mem.db, { userId, deviceId }, config);
  const state = async (sessionId: string) => (await lookupSession(mem.db, sessionId)).state;
  const check = (sid: string, deviceSecret: string, config: SecurityConfig = ENFORCE) =>
    evaluateSecurityContext(
      mem.db,
      { userId: userId.toHexString(), issuedAt: AFTER_CUTOVER, cookies: { sid, device: deviceSecret } },
      config,
    );

  describe("enforce (NEWEST_WINS, max 1)", () => {
    it("one active session: a login on a second device evicts the first", async () => {
      const laptop = await device();
      const phone = await device();
      const a = await login(laptop.device._id);
      expect(a?.concurrency).toMatchObject({ generation: 1, evicted: 0, selfEvicted: false });
      expect((await check(a!.sessionId, laptop.secret)).session).toBe("VALID");

      const b = await login(phone.device._id);
      expect(b?.concurrency).toMatchObject({ generation: 2, evicted: 1, selfEvicted: false });

      const old = await lookupSession(mem.db, a!.sessionId);
      expect(old.state).toBe("REVOKED");
      if (old.state === "REVOKED") expect(old.session.revokedReason).toBe("EVICTED");
      expect((await check(a!.sessionId, laptop.secret)).session).toBe("EVICTED");
      // The new session is untouched.
      expect(await state(b!.sessionId)).toBe("VALID");
      expect((await check(b!.sessionId, phone.secret)).session).toBe("VALID");
      expect(await sessions().countDocuments({ userId, status: "ACTIVE" })).toBe(1);
    });

    it("an evicted session stays refused on repeated/replayed requests", async () => {
      const laptop = await device();
      const phone = await device();
      const a = await login(laptop.device._id);
      await login(phone.device._id);
      for (let i = 0; i < 3; i += 1) {
        expect((await check(a!.sessionId, laptop.secret)).session).toBe("EVICTED");
      }
      // Idempotent: one eviction event for that session, not one per request.
      expect(await events().countDocuments({ type: "SESSION_EVICTED" })).toBe(1);
    });

    it("the old session is refused even before its row is swept (per-request check)", async () => {
      const laptop = await device();
      const phone = await device();
      const a = await login(laptop.device._id);
      // A newer session on another device exists but its sweep hasn't run.
      const generation = await claimSessionGeneration(mem.db, userId);
      await sessions().insertOne({
        _id: new ObjectId(),
        sessionIdHash: "f".repeat(64),
        userId,
        deviceId: phone.device._id,
        status: "ACTIVE",
        rememberMe: false,
        createdAt: new Date(),
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
        revokedReason: null,
        generation,
      });
      expect(await state(a!.sessionId)).toBe("VALID");
      expect((await check(a!.sessionId, laptop.secret)).session).toBe("EVICTED");
      expect(await state(a!.sessionId)).toBe("REVOKED");
    });

    it("a session whose login never finished counting can't be used", async () => {
      const laptop = await device();
      const a = await login(laptop.device._id);
      await sessions().updateOne({ userId }, { $set: { generationPending: true } });
      const doc = await sessions().findOne({ userId });
      expect(await isEvictedByNewerSession(mem.db, doc as never, ENFORCE)).toBe(true);
      expect(await state(a!.sessionId)).toBe("REVOKED");
    });

    it("same-device re-login replaces its session (REPLACED), not EVICTED", async () => {
      const laptop = await device();
      const a = await login(laptop.device._id);
      const b = await login(laptop.device._id);
      const old = await lookupSession(mem.db, a!.sessionId);
      if (old.state !== "REVOKED") throw new Error("expected revoked");
      expect(old.session.revokedReason).toBe("REPLACED");
      expect(b?.concurrency.evicted).toBe(0);
      expect((await check(b!.sessionId, laptop.secret)).session).toBe("VALID");
    });

    it("simultaneous logins on many devices leave exactly one session: the newest", async () => {
      const devs = [];
      for (let i = 0; i < 10; i += 1) devs.push(await device());
      const results = await Promise.all(devs.map((d) => login(d.device._id)));

      const active = await sessions().find({ userId, status: "ACTIVE" }).toArray();
      expect(active).toHaveLength(1);
      const maxGen = Math.max(...results.map((r) => r!.concurrency.generation!));
      expect(active[0].generation).toBe(maxGen);

      // Generations are unique and gap-free: the winner is deterministic.
      const gens = results.map((r) => r!.concurrency.generation).sort((x, y) => x! - y!);
      expect(gens).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));

      // Only the winner passes validation.
      const valid = [];
      for (let i = 0; i < devs.length; i += 1) {
        const ctx = await check(results[i]!.sessionId, devs[i].secret);
        if (ctx.session === "VALID") valid.push(results[i]!.concurrency.generation);
      }
      expect(valid).toEqual([maxGen]);
    });

    it("stress: mixed same-device and cross-device races always end with one session", { timeout: 120_000 }, async () => {
      for (let round = 0; round < 8; round += 1) {
        await mem.reset();
        await ensureIndexes(mem.db, "apply");
        const devs = [];
        for (let i = 0; i < 5; i += 1) devs.push(await device());
        // Two logins per device, all at once.
        const results = await Promise.all(
          devs.flatMap((d) => [login(d.device._id), login(d.device._id)]),
        );
        const active = await sessions().find({ userId, status: "ACTIVE" }).toArray();
        expect(active).toHaveLength(1);
        const stamped = await sessions()
          .find({ userId, generation: { $type: "number" } })
          .sort({ generation: -1 })
          .limit(1)
          .toArray();
        expect(active[0]._id).toEqual(stamped[0]._id);
        // Every login got a result; the survivor is reported as not evicted.
        const survivor = results.find((r) => r && r.session._id.equals(active[0]._id));
        expect(survivor?.concurrency.selfEvicted).toBe(false);
      }
    });

    it("simultaneous logins on the same device keep one session", async () => {
      const laptop = await device();
      await Promise.allSettled(Array.from({ length: 8 }, () => login(laptop.device._id)));
      expect(await sessions().countDocuments({ userId, status: "ACTIVE" })).toBe(1);
    });

    it("respects a configured limit of 2", async () => {
      const two = cfg({ SECURITY_CONCURRENCY_ENABLED: "enforce", SECURITY_MAX_CONCURRENT_SESSIONS: "2" });
      const d = [await device(two), await device(two), await device(two)];
      const s = [];
      for (const x of d) s.push(await login(x.device._id, two));
      expect((await check(s[0]!.sessionId, d[0].secret, two)).session).toBe("EVICTED");
      expect((await check(s[1]!.sessionId, d[1].secret, two)).session).toBe("VALID");
      expect((await check(s[2]!.sessionId, d[2].secret, two)).session).toBe("VALID");
    });

    it("sessions from before I4 (no generation) are evicted by the next counted login", async () => {
      const laptop = await device();
      const phone = await device();
      const legacy = await startSessionWithConcurrency(mem.db, { userId, deviceId: laptop.device._id }, OFF);
      expect(legacy?.session.generation).toBeNull();
      // Turning enforcement on alone doesn't end it...
      expect((await check(legacy!.sessionId, laptop.secret)).session).toBe("VALID");
      // ...a new login does.
      await login(phone.device._id);
      expect((await check(legacy!.sessionId, laptop.secret)).session).toBe("EVICTED");
    });

    it("device revocation still ends that device's session", async () => {
      const laptop = await device();
      const phone = await device();
      await login(laptop.device._id);
      const b = await login(phone.device._id);
      await revokeDevice(mem.db, userId, phone.device._id);
      const s = await lookupSession(mem.db, b!.sessionId);
      if (s.state !== "REVOKED") throw new Error("expected revoked");
      expect(s.session.revokedReason).toBe("DEVICE_REVOKED");
    });
  });

  describe("pending devices", () => {
    it("with device trust enforced, a pending device neither counts nor evicts", async () => {
      const laptop = await device(DEVICE_ENFORCE);
      const phone = await device(DEVICE_ENFORCE); // pending
      const a = await login(laptop.device._id, DEVICE_ENFORCE);
      const p = await login(phone.device._id, DEVICE_ENFORCE);
      expect(p?.session.pendingExempt).toBe(true);
      expect(p?.concurrency.generation).toBeNull();
      expect(await state(a!.sessionId)).toBe("VALID");
      expect((await check(a!.sessionId, laptop.secret, DEVICE_ENFORCE)).session).toBe("VALID");
      // The pending phone itself is blocked by the device check.
      expect((await check(p!.sessionId, phone.secret, DEVICE_ENFORCE)).device).toBe("UNTRUSTED");
    });

    it("approval promotes the pending session and it wins (NEWEST_WINS)", async () => {
      const laptop = await device(DEVICE_ENFORCE);
      const phone = await device(DEVICE_ENFORCE);
      const a = await login(laptop.device._id, DEVICE_ENFORCE);
      const p = await login(phone.device._id, DEVICE_ENFORCE);
      const approved = await trustPendingDevice(
        mem.db,
        { userId, deviceId: phone.device._id, decidedBy: new ObjectId(), actionId: new ObjectId(), method: "ADMIN_APPROVAL" },
        DEVICE_ENFORCE,
      );
      expect(approved.outcome).toBe("TRUSTED");
      const promoted = await sessions().findOne({ _id: p!.session._id });
      expect(promoted?.pendingExempt).toBeUndefined();
      expect(promoted?.generation).toBe(2);
      expect((await check(p!.sessionId, phone.secret, DEVICE_ENFORCE))).toMatchObject({ session: "VALID", device: "MATCH" });
      expect((await check(a!.sessionId, laptop.secret, DEVICE_ENFORCE)).session).toBe("EVICTED");
    });

    it("rejection ends the pending session and leaves the trusted one alone", async () => {
      const laptop = await device(DEVICE_ENFORCE);
      const phone = await device(DEVICE_ENFORCE);
      const a = await login(laptop.device._id, DEVICE_ENFORCE);
      const p = await login(phone.device._id, DEVICE_ENFORCE);
      await rejectPendingDevice(mem.db, { userId, deviceId: phone.device._id, decidedBy: new ObjectId(), actionId: new ObjectId() }, DEVICE_ENFORCE);
      expect(await state(p!.sessionId)).toBe("REVOKED");
      expect((await check(a!.sessionId, laptop.secret, DEVICE_ENFORCE)).session).toBe("VALID");
    });

    it("an expired device can't start a session at all", async () => {
      await device(DEVICE_ENFORCE);
      const phone = await device(DEVICE_ENFORCE);
      await mem.db.collection("SecurityDevice").updateOne({ _id: phone.device._id }, { $set: { status: "EXPIRED" } });
      expect(await login(phone.device._id, DEVICE_ENFORCE)).toBeNull();
    });
  });

  describe("detect and off", () => {
    it("detect records a would-evict event but ends nothing", async () => {
      const laptop = await device(DETECT);
      const phone = await device(DETECT);
      const a = await login(laptop.device._id, DETECT);
      const b = await login(phone.device._id, DETECT);
      expect(b?.concurrency).toMatchObject({ mode: "detect", evicted: 1, selfEvicted: false });
      expect(await state(a!.sessionId)).toBe("VALID");
      expect((await check(a!.sessionId, laptop.secret, DETECT)).session).toBe("VALID");
      const ev = await events().findOne({ type: "CONCURRENT_SESSION_DETECTED" });
      expect(ev?.metadata).toMatchObject({ mode: "detect", wouldEvict: 1 });
      expect(await events().countDocuments({ type: "SESSION_EVICTED" })).toBe(0);
    });

    it("off: no generation, no events, both sessions valid", async () => {
      const laptop = await device(OFF);
      const phone = await device(OFF);
      const a = await login(laptop.device._id, OFF);
      const b = await login(phone.device._id, OFF);
      expect(b?.concurrency).toMatchObject({ mode: "off", generation: null });
      expect(await state(a!.sessionId)).toBe("VALID");
      expect(await events().countDocuments({ type: { $in: ["CONCURRENT_SESSION_DETECTED", "SESSION_EVICTED"] } })).toBe(0);
      expect((await mem.db.collection("SecurityAccount").findOne({ _id: userId }))?.sessionGeneration).toBeUndefined();
    });
  });

  it("eviction events are useful for I5 and contain no secrets", async () => {
    const laptop = await device();
    const phone = await device();
    const a = await login(laptop.device._id);
    const b = await login(phone.device._id);
    const evicted = await events().findOne({ type: "SESSION_EVICTED" });
    expect(evicted).toMatchObject({
      userId,
      deviceId: laptop.device._id,
      reasonCodes: ["NEWEST_WINS"],
      metadata: { evictedGeneration: 1, byGeneration: 2, byDeviceId: phone.device._id.toHexString(), sameDevice: false },
    });
    expect(evicted?.sessionRef).toMatch(/^[a-f0-9]{16}$/);
    const stored = JSON.stringify(await events().find().toArray());
    for (const secret of [a!.sessionId, b!.sessionId, laptop.secret, phone.secret]) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toMatch(/sessionIdHash|secretHash/);
  });
});
