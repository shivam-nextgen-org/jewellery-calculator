import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { liftRestrictionAsAdmin, listRestrictedAccounts } from "@/lib/security/admin-restrictions";
import { accountStateFromUser, decideAccess, type AccountState } from "@/lib/security/authorize";
import { getSecurityConfig } from "@/lib/security/config";
import { recordSecurityEvent } from "@/lib/security/events";
import { ensureIndexes } from "@/lib/security/indexes";
import {
  getRestrictionState,
  isRestrictionActive,
  settleExpiredRestriction,
} from "@/lib/security/restriction";
import { evaluateCustomerRisk } from "@/lib/security/risk";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const env = (v: Record<string, string> = {}) =>
  getSecurityConfig({ NODE_ENV: "test", ...v } as NodeJS.ProcessEnv);
const ACT = env({
  SECURITY_RISK_ENGINE_ENABLED: "act",
  SECURITY_RESTRICTIONS_ENABLED: "on",
  SECURITY_ACCESS_DECISION: "enforce",
});
const LOG_ONLY = env({ SECURITY_RISK_ENGINE_ENABLED: "log-only", SECURITY_RESTRICTIONS_ENABLED: "on" });
const T0 = new Date("2026-10-01T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(T0.getTime() + ms);
const ADMIN_PASSWORD = "AdminPass123";
const statusOf = (s: AccountState) => ({ status: s.state === "FOUND" ? s.status : s.state, raw: s });

describe("temporary restrictions (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: ObjectId;
  let adminId: ObjectId;
  const account = () => mem.db.collection("SecurityAccount").findOne({ _id: userId });
  const docs = () => mem.db.collection("SecurityRestriction").find({ userId }).toArray();
  const audits = () => mem.db.collection("SecurityAdminAction").find().toArray();

  beforeAll(async () => {
    mem = await startMemoryDb();
    vi.stubEnv("SESSION_SECRET", "restriction-test-secret-0123456789");
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await mem?.stop();
  });
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId();
    adminId = new ObjectId();
    await mem.db.collection("User").insertMany([
      { _id: userId, role: "USER", isActive: true, email: "c@example.com", name: "Cust" },
      { _id: adminId, role: "SUPER_ADMIN", isActive: true, email: "a@example.com", passwordHash: await hashPassword(ADMIN_PASSWORD) },
    ]);
  });

  const event = (type: string, when: Date, extra: Record<string, unknown> = {}) =>
    recordSecurityEvent(mem.db, { type: type as never, actorType: "SYSTEM", userId, occurredAt: when, ...extra });
  /** 5 wrong passwords → MEDIUM. */
  async function medium(when = T0) {
    for (let i = 0; i < 5; i += 1) await event("LOGIN_FAILED", new Date(when.getTime() - (i + 1) * MIN));
  }
  /** + a device mismatch → HIGH. */
  async function high(when = T0) {
    await medium(when);
    await event("SESSION_DEVICE_MISMATCH", new Date(when.getTime() - MIN));
  }
  /** + 3 cross-device evictions → CRITICAL. */
  async function critical(when = T0) {
    await high(when);
    for (let i = 0; i < 3; i += 1) {
      await event("SESSION_EVICTED", new Date(when.getTime() - (i + 1) * MIN), {
        sessionRef: `${i}`.repeat(16).slice(0, 16).replace(/./g, String(i)),
        metadata: { sameDevice: false },
      });
    }
  }
  const evaluate = (now: Date, config = ACT) => evaluateCustomerRisk(mem.db, userId, config, now);
  const accessAt = async (now: Date) => {
    const acc = await account();
    const user = await mem.db.collection("User").findOne({ _id: userId });
    return statusOf(accountStateFromUser(user as never, (acc ?? {}) as never, now));
  };

  describe("risk → policy mapping", () => {
    it("LOW: nothing", async () => {
      expect((await evaluate(T0))?.action).toBe("NONE");
      expect(await docs()).toHaveLength(0);
    });

    it("MEDIUM: review flag only, access continues", async () => {
      await medium();
      expect((await evaluate(T0))?.action).toBe("REVIEW_FLAGGED");
      expect(await docs()).toHaveLength(0);
      expect((await account())?.review).toMatchObject({ source: "RISK_MEDIUM" });
      const state = await accessAt(T0);
      expect(state).toMatchObject({ status: "REVIEW_REQUIRED" });
      expect(decideAccess({ requirement: "USER", principal: { kind: "SESSION", user: { id: userId.toHexString(), email: "", name: "", role: "USER" } }, account: state.raw }).allow).toBe(true);
    });

    it("HIGH: 24h temporary restriction with explainable reasons", async () => {
      await high();
      expect((await evaluate(T0))?.action).toBe("RESTRICTED");
      const [doc] = await docs();
      expect(doc).toMatchObject({
        status: "ACTIVE",
        level: "HIGH",
        source: "RISK_ENGINE",
        createdBy: null,
        reviewRequired: false,
        reasonCodes: ["SESSION_DEVICE_MISMATCH", "LOGIN_FAILURE_BURST"],
      });
      expect(doc.expiresAt.getTime() - T0.getTime()).toBe(24 * HOUR);
      expect(doc.maxExpiresAt.getTime() - T0.getTime()).toBe(7 * DAY);
      expect(doc.assessmentId).toBeInstanceOf(ObjectId);
      expect((await accessAt(T0)).status).toBe("TEMPORARILY_RESTRICTED");
    });

    it("CRITICAL: blocked pending review, at most 7 days, flag set", async () => {
      await critical();
      expect((await evaluate(T0))?.action).toBe("RESTRICTED");
      const [doc] = await docs();
      expect(doc).toMatchObject({ level: "CRITICAL", reviewRequired: true });
      expect(doc.expiresAt.getTime() - T0.getTime()).toBe(7 * DAY);
      expect((await account())?.review).toMatchObject({ source: "RISK_CRITICAL" });
    });

    it("log-only and off never restrict", async () => {
      await critical();
      expect((await evaluate(T0, LOG_ONLY))?.action).toBeUndefined();
      expect(await evaluate(T0, env())).toBeNull();
      expect(await docs()).toHaveLength(0);
      expect((await account())?.restriction).toBeUndefined();
    });
  });

  describe("bounded renewal", () => {
    it("repeated evaluations never extend an active restriction", async () => {
      await high();
      await evaluate(T0);
      for (let i = 1; i <= 5; i += 1) {
        await event("LOGIN_FAILED", at(i * HOUR));
        expect((await evaluate(at(i * HOUR)))?.action).toBe("ALREADY_RESTRICTED");
      }
      const [doc] = await docs();
      expect(doc.expiresAt.getTime() - T0.getTime()).toBe(24 * HOUR);
      expect((await account())?.restriction.expiresAt).toEqual(doc.expiresAt);
    });

    it("HIGH → CRITICAL escalates once, ending at start + 7 days", async () => {
      await high();
      await evaluate(T0);
      const later = at(2 * HOUR);
      await critical(later);
      expect((await evaluate(later))?.action).toBe("ESCALATED");
      const [doc] = await docs();
      expect(doc).toMatchObject({ level: "CRITICAL", reviewRequired: true });
      expect(doc.expiresAt.getTime() - T0.getTime()).toBe(7 * DAY);
      expect((await evaluate(at(3 * HOUR)))?.action).toBe("ALREADY_RESTRICTED");
      expect(await docs()).toHaveLength(1);
    });

    it("lower risk never lifts an active restriction early", async () => {
      await high();
      await evaluate(T0);
      const r = await evaluate(at(12 * HOUR)); // login failures have aged out
      expect(r?.result.tier).not.toBe("HIGH");
      expect(isRestrictionActive((await account())?.restriction, at(12 * HOUR))).toBe(true);
    });
  });

  describe("expiry", () => {
    it("stops blocking exactly at expiresAt, before any cleanup runs", async () => {
      await high();
      await evaluate(T0);
      expect((await accessAt(at(24 * HOUR - 1))).status).toBe("TEMPORARILY_RESTRICTED");
      expect((await accessAt(at(24 * HOUR))).status).toBe("ACTIVE");
      expect((await getRestrictionState(mem.db, userId, at(24 * HOUR))).restricted).toBe(false);
    });

    it("settle records EXPIRED once; the same old events can't re-restrict", async () => {
      await high();
      await evaluate(T0);
      const after = at(24 * HOUR);
      const settled = await Promise.all([settleExpiredRestriction(mem.db, userId, after), settleExpiredRestriction(mem.db, userId, after)]);
      expect(settled.filter(Boolean)).toHaveLength(1);
      expect((await docs())[0]).toMatchObject({ status: "EXPIRED" });
      expect((await evaluate(after))?.action).toBe("NONE");
      // New evidence after the restriction ended can restrict again.
      await high(at(26 * HOUR));
      expect((await evaluate(at(26 * HOUR)))?.action).toBe("RESTRICTED");
      expect((await docs()).map((d) => d.status).sort()).toEqual(["ACTIVE", "EXPIRED"]);
    });

    it("CRITICAL expires at the maximum but stays flagged for review", async () => {
      await critical();
      await evaluate(T0);
      const after = at(7 * DAY);
      expect((await accessAt(after)).status).toBe("REVIEW_REQUIRED");
      await settleExpiredRestriction(mem.db, userId, after);
      expect((await account())?.restriction).toBeNull();
      expect((await account())?.review).toBeTruthy();
    });
  });

  describe("races", () => {
    it("concurrent evaluations create exactly one active restriction", async () => {
      await high();
      const results = await Promise.all(Array.from({ length: 8 }, () => evaluate(T0)));
      expect(results.filter((r) => r?.action === "RESTRICTED")).toHaveLength(1);
      const all = await docs();
      expect(all.filter((d) => d.status === "ACTIVE")).toHaveLength(1);
      expect(all.every((d) => d.status === "ACTIVE" || d.status === "NOT_APPLIED")).toBe(true);
      const acc = await account();
      expect(acc?.restriction.id).toEqual(all.find((d) => d.status === "ACTIVE")!._id);
    });

    it("admin lift racing an evaluation never leaves a resurrected restriction", async () => {
      for (let round = 0; round < 5; round += 1) {
        await mem.reset();
        await ensureIndexes(mem.db, "apply");
        await mem.db.collection("User").insertMany([
          { _id: userId, role: "USER", isActive: true, email: "c@example.com" },
          { _id: adminId, role: "SUPER_ADMIN", isActive: true, email: "a@example.com", passwordHash: await hashPassword(ADMIN_PASSWORD) },
        ]);
        await high();
        await evaluate(T0);
        const [doc] = await docs();
        const liftAt = at(HOUR);
        await Promise.all([
          liftRestrictionAsAdmin(mem.db, { adminId: adminId.toHexString(), restrictionId: doc._id, userId, password: ADMIN_PASSWORD, reason: "Verified", now: liftAt }),
          evaluate(liftAt),
          evaluate(liftAt),
        ]);
        await evaluate(at(2 * HOUR));
        expect((await getRestrictionState(mem.db, userId, at(2 * HOUR))).restricted).toBe(false);
        expect((await docs()).filter((d) => d.status === "ACTIVE")).toHaveLength(0);
      }
    }, 60_000);
  });

  describe("admin lift", () => {
    async function restricted() {
      await critical();
      await evaluate(T0);
      return (await docs())[0];
    }
    const lift = (overrides: Record<string, unknown> = {}) =>
      liftRestrictionAsAdmin(mem.db, {
        adminId: adminId.toHexString(),
        restrictionId: overrides.restrictionId ?? undefined,
        userId,
        password: ADMIN_PASSWORD,
        reason: "Verified legitimate customer",
        ip: "203.0.113.4",
        now: at(HOUR),
        ...overrides,
      } as never);

    it("requires a reason and the admin's password", async () => {
      const doc = await restricted();
      expect(await lift({ restrictionId: doc._id, reason: "" })).toMatchObject({ ok: false, status: 400 });
      expect(await lift({ restrictionId: doc._id, password: "wrong-pass-1" })).toMatchObject({ ok: false, status: 401 });
      expect(await lift({ restrictionId: doc._id, adminId: userId.toHexString() })).toMatchObject({ ok: false, status: 401 });
      expect((await account())?.restriction).toBeTruthy();
      expect(await audits()).toHaveLength(0);
    });

    it("lifts, clears review, audits first; repeat is a no-op", async () => {
      const doc = await restricted();
      expect(await lift({ restrictionId: doc._id })).toEqual({ ok: true, outcome: "REMOVED" });
      const [audit] = await audits();
      expect(audit).toMatchObject({ action: "RESTRICTION_REMOVED", adminId, targetUserId: userId, reason: "Verified legitimate customer" });
      const [after] = await docs();
      expect(after).toMatchObject({ status: "REMOVED", removedBy: adminId, removalActionId: audit._id });
      expect(audit.occurredAt.getTime()).toBeLessThanOrEqual(after.endedAt.getTime());
      expect(await account()).toMatchObject({ restriction: null, review: null });
      expect(await lift({ restrictionId: doc._id })).toEqual({ ok: true, outcome: "ALREADY_ENDED" });
      expect(await audits()).toHaveLength(1);
      // The same events can't immediately re-restrict.
      expect((await evaluate(at(2 * HOUR)))?.action).toBe("NONE");
    });

    it("if the audit write fails, nothing changes (fail closed)", async () => {
      const doc = await restricted();
      const original = mem.db.collection.bind(mem.db);
      const spy = vi.spyOn(mem.db, "collection").mockImplementation(((name: string) => {
        const col = original(name);
        if (name === "SecurityAdminAction") return { ...col, insertOne: async () => { throw new Error("audit down"); } };
        return col;
      }) as typeof mem.db.collection);
      await expect(lift({ restrictionId: doc._id })).rejects.toThrow("audit down");
      spy.mockRestore();
      expect((await account())?.restriction?.id).toEqual(doc._id);
    });

    it("wrong customer, unknown or malformed ids look like not found", async () => {
      const doc = await restricted();
      const other = new ObjectId();
      await mem.db.collection("User").insertOne({ _id: other, role: "USER", email: "o@example.com" });
      expect(await lift({ restrictionId: doc._id, userId: other })).toMatchObject({ status: 404 });
      expect(await lift({ restrictionId: new ObjectId() })).toMatchObject({ status: 404 });
      expect(await lift({ restrictionId: "x" })).toMatchObject({ status: 404 });
      expect((await account())?.restriction?.id).toEqual(doc._id);
    });

    it("doesn't touch devices, sessions or the concurrency counter", async () => {
      const doc = await restricted();
      await mem.db.collection("SecurityAccount").updateOne({ _id: userId }, { $set: { deviceSlotsUsed: 2, sessionGeneration: 9, enrolledAt: T0 } });
      await lift({ restrictionId: doc._id });
      expect(await account()).toMatchObject({ deviceSlotsUsed: 2, sessionGeneration: 9, enrolledAt: T0 });
    });

    it("admin list shows reasons but no signals, IPs or scores", async () => {
      await restricted();
      const list = await listRestrictedAccounts(mem.db, at(HOUR));
      expect(list).toHaveLength(1);
      expect(list[0].restriction).toMatchObject({ level: "CRITICAL", reviewRequired: true });
      const text = JSON.stringify(list);
      expect(text).not.toMatch(/ipHash|score|signals|203\.0\.113/);
    });
  });

  it("a disabled account stays SUSPENDED whatever the restriction state", async () => {
    await high();
    await evaluate(T0);
    const acc = await account();
    expect(statusOf(accountStateFromUser({ role: "USER", isActive: false }, acc as never, T0)).status).toBe("SUSPENDED");
    expect(statusOf(accountStateFromUser({ role: "USER", isActive: false }, {}, T0)).status).toBe("SUSPENDED");
  });

  it("restriction records contain no secrets or raw network data", async () => {
    await recordSecurityEvent(mem.db, { type: "LOGIN_FAILED", actorType: "USER", userId, ip: "198.51.100.9", occurredAt: T0 });
    await critical();
    await evaluate(T0);
    const text = JSON.stringify([await docs(), await account()]);
    expect(text).not.toMatch(/198\.51\.100\.9|ipHash|sessionRef|passwordHash/);
  });
});
