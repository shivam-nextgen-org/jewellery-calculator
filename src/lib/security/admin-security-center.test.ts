import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import {
  getCustomerSecurityDetail,
  listCustomerSecurity,
  performAdminSecurityAction,
} from "@/lib/security/admin-security-center";
import { STEP_UP_MAX_FAILURES } from "@/lib/security/admin-step-up";
import { startSessionWithConcurrency } from "@/lib/security/concurrency";
import { getSecurityConfig } from "@/lib/security/config";
import { evaluateSecurityContext } from "@/lib/security/context";
import { expirePendingDevice, registerDevice } from "@/lib/security/device-registry";
import { recordSecurityEvent } from "@/lib/security/events";
import { ensureIndexes } from "@/lib/security/indexes";
import { evaluateCustomerRisk } from "@/lib/security/risk";
import { lookupSession } from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const ADMIN_PASSWORD = "AdminPass123";
const CONFIG = getSecurityConfig({
  NODE_ENV: "test",
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_DEVICE_VERIFICATION_ENABLED: "on",
  SECURITY_SESSIONS_ENABLED: "enforce",
  SECURITY_SESSIONS_CUTOVER_AT: "2026-01-01T00:00:00Z",
  SECURITY_CONCURRENCY_ENABLED: "enforce",
  SECURITY_RISK_ENGINE_ENABLED: "act",
  SECURITY_RESTRICTIONS_ENABLED: "on",
  SECURITY_ADMIN_SECURITY_CENTER: "on",
} as NodeJS.ProcessEnv);
const NO_RESTRICTIONS = getSecurityConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const HOUR = 3_600_000;

describe("Admin Security Center service (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let adminId: ObjectId;
  let admin2Id: ObjectId;
  let userId: ObjectId;
  let otherId: ObjectId;

  const audits = () => mem.db.collection("SecurityAdminAction").find().toArray();
  const account = () => mem.db.collection("SecurityAccount").findOne({ _id: userId });

  beforeAll(async () => {
    mem = await startMemoryDb();
    vi.stubEnv("SESSION_SECRET", "center-test-secret-0123456789");
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await mem?.stop();
  });
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    adminId = new ObjectId();
    admin2Id = new ObjectId();
    userId = new ObjectId();
    otherId = new ObjectId();
    const hash = await hashPassword(ADMIN_PASSWORD);
    await mem.db.collection("User").insertMany([
      { _id: adminId, email: "a1@example.com", role: "SUPER_ADMIN", isActive: true, passwordHash: hash },
      { _id: admin2Id, email: "a2@example.com", role: "SUPER_ADMIN", isActive: true, passwordHash: hash },
      { _id: userId, email: "c@example.com", name: "Cust", role: "USER", isActive: true, passwordHash: "$2b$10$notarealhashnotarealhashnotarealhashnotarealhas" },
      { _id: otherId, email: "o@example.com", name: "Other", role: "USER", isActive: true },
    ]);
  });

  const act = (action: string, body: Record<string, unknown> = {}, over: Partial<{ adminId: string; userId: unknown; now: Date; config: typeof CONFIG }> = {}) =>
    performAdminSecurityAction(
      mem.db,
      {
        adminId: over.adminId ?? adminId.toHexString(),
        userId: over.userId ?? userId,
        action,
        body: { password: ADMIN_PASSWORD, reason: "Support ticket 42", ...body },
        ip: "203.0.113.50",
        now: over.now,
      },
      over.config ?? CONFIG,
    );

  async function device(user = userId) {
    const r = await registerDevice(mem.db, { userId: user }, CONFIG);
    if (r.outcome !== "CREATED") throw new Error("expected CREATED");
    return r;
  }
  async function session(deviceId: ObjectId, user = userId, now?: Date) {
    const s = await startSessionWithConcurrency(mem.db, { userId: user, deviceId, now }, CONFIG);
    if (!s) throw new Error("expected session");
    return s;
  }
  const ctx = (sid: string, secret: string, user = userId) =>
    evaluateSecurityContext(mem.db, { userId: user.toHexString(), issuedAt: new Date(), cookies: { sid, device: secret } }, CONFIG);

  /** Breaks audit writes for one call. */
  function breakAudit() {
    const original = mem.db.collection.bind(mem.db);
    return vi.spyOn(mem.db, "collection").mockImplementation(((name: string) => {
      const c = original(name);
      if (name === "SecurityAdminAction") return { ...c, insertOne: async () => { throw new Error("audit down"); } };
      return c;
    }) as typeof mem.db.collection);
  }

  describe("authorization and targets", () => {
    it("disabled admins and non-admins can't act", async () => {
      await mem.db.collection("User").updateOne({ _id: adminId }, { $set: { isActive: false } });
      expect(await act("FORCE_LOGOUT")).toMatchObject({ ok: false, status: 403 });
      expect(await act("FORCE_LOGOUT", {}, { adminId: userId.toHexString() })).toMatchObject({ ok: false, status: 403 });
      expect(await act("FORCE_LOGOUT", {}, { adminId: "nope" })).toMatchObject({ ok: false, status: 403 });
    });

    it("unknown, malformed, admin and deleted targets look like not found", async () => {
      for (const target of [new ObjectId(), "x", '{"$ne":null}', admin2Id]) {
        expect(await act("FORCE_LOGOUT", {}, { userId: target })).toMatchObject({ ok: false, status: 404 });
      }
      await mem.db.collection("User").deleteOne({ _id: otherId });
      expect(await act("FORCE_LOGOUT", {}, { userId: otherId })).toMatchObject({ status: 404 });
      expect(await getCustomerSecurityDetail(mem.db, admin2Id, CONFIG)).toBeNull();
      expect(await getCustomerSecurityDetail(mem.db, "garbage", CONFIG)).toBeNull();
    });

    it("unknown action and missing reason are rejected before step-up", async () => {
      expect(await act("BAN_FOREVER")).toMatchObject({ ok: false, status: 400 });
      expect(await act("FORCE_LOGOUT", { reason: "" })).toMatchObject({ ok: false, status: 400 });
      expect(await mem.db.collection("SecurityEvent").countDocuments({ type: "ADMIN_STEP_UP_FAILED" })).toBe(0);
    });

    it("step-up is required on every action and locks after repeated failures", async () => {
      const d = await device();
      await session(d.device._id);
      expect(await act("FORCE_LOGOUT", { password: undefined })).toMatchObject({ status: 400 });
      for (let i = 0; i < STEP_UP_MAX_FAILURES; i += 1) {
        expect(await act("FORCE_LOGOUT", { password: `wrong-${i}-x` })).toMatchObject({ status: 401 });
      }
      expect(await act("FORCE_LOGOUT")).toMatchObject({ status: 429 });
      expect(await audits()).toHaveLength(0);
    });

    it("cross-customer device and session ids are not found and change nothing", async () => {
      const theirs = await device(otherId);
      const s = await session(theirs.device._id, otherId);
      expect(await act("DEVICE_REVOKE", { deviceId: theirs.device._id.toHexString() })).toMatchObject({ status: 404 });
      expect(await act("DEVICE_RENAME", { deviceId: theirs.device._id.toHexString(), label: "x" })).toMatchObject({ status: 404 });
      expect(await act("SESSION_REVOKE", { sessionId: s.session._id.toHexString() })).toMatchObject({ status: 404 });
      expect(await act("DEVICE_APPROVE", { deviceId: theirs.device._id.toHexString() })).toMatchObject({ status: 404 });
      expect(await act("SESSION_REVOKE", { sessionId: "123" })).toMatchObject({ status: 404 });
      expect((await lookupSession(mem.db, s.sessionId)).state).toBe("VALID");
      expect(await audits()).toHaveLength(0);
    });
  });

  describe("devices", () => {
    it("revoke: audit first, frees slot, ends sessions; repeat is a no-op", async () => {
      const d = await device();
      const s = await session(d.device._id);
      expect(await act("DEVICE_REVOKE", { deviceId: d.device._id.toHexString() })).toEqual({ ok: true, outcome: "REVOKED", applied: true });
      const stored = await mem.db.collection("SecurityDevice").findOne({ _id: d.device._id });
      expect(stored).toMatchObject({ status: "REVOKED", revokedReason: "ADMIN_REVOKED" });
      expect((await account())?.deviceSlotsUsed).toBe(0);
      expect((await ctx(s.sessionId, d.secret)).session).toBe("REVOKED");
      const [audit] = await audits();
      expect(audit).toMatchObject({ action: "DEVICE_REVOKE", adminId, targetUserId: userId, reason: "Support ticket 42" });
      expect(audit.ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await act("DEVICE_REVOKE", { deviceId: d.device._id.toHexString() })).toEqual({ ok: true, outcome: "ALREADY_REVOKED", applied: false });
      expect(await audits()).toHaveLength(1);
    });

    it("two admins revoking the same device: one applies", async () => {
      const d = await device();
      const results = await Promise.all([
        act("DEVICE_REVOKE", { deviceId: d.device._id.toHexString() }),
        act("DEVICE_REVOKE", { deviceId: d.device._id.toHexString() }, { adminId: admin2Id.toHexString() }),
      ]);
      expect(results.filter((r) => r.ok && r.applied)).toHaveLength(1);
      expect((await account())?.deviceSlotsUsed).toBe(0);
    });

    it("revoke racing a login never leaves a usable session on the revoked device", async () => {
      for (let round = 0; round < 5; round += 1) {
        const d = await device();
        await Promise.all([
          startSessionWithConcurrency(mem.db, { userId, deviceId: d.device._id }, CONFIG),
          act("DEVICE_REVOKE", { deviceId: d.device._id.toHexString() }),
        ]);
        expect(await mem.db.collection("SecuritySession").countDocuments({ deviceId: d.device._id, status: "ACTIVE" })).toBe(0);
      }
    });

    it("rename validates and audits; approve/reject reuse the I3 flow", async () => {
      await device(); // enrollment
      const pending = await device();
      expect(await act("DEVICE_RENAME", { deviceId: pending.device._id.toHexString(), label: "x".repeat(41) })).toMatchObject({ status: 400 });
      expect(await act("DEVICE_RENAME", { deviceId: pending.device._id.toHexString(), label: "Office PC", reason: undefined })).toMatchObject({ outcome: "RENAMED" });
      expect(await act("DEVICE_APPROVE", { deviceId: pending.device._id.toHexString() })).toMatchObject({ outcome: "TRUSTED", applied: true });
      expect(await act("DEVICE_APPROVE", { deviceId: pending.device._id.toHexString() })).toMatchObject({ outcome: "ALREADY_TRUSTED", applied: false });
      const actions = (await audits()).map((a) => a.action).sort();
      expect(actions).toEqual(["DEVICE_APPROVED", "DEVICE_RENAME"]);
    });

    it("approval racing expiry at the deadline: expiry wins", async () => {
      await device();
      const pending = await device();
      const deadline = new Date(pending.device.pendingExpiresAt!.getTime());
      const [approve] = await Promise.all([
        act("DEVICE_APPROVE", { deviceId: pending.device._id.toHexString() }, { now: deadline }),
        expirePendingDevice(mem.db, pending.device._id, deadline, CONFIG),
      ]);
      expect(approve).toMatchObject({ ok: true, applied: false });
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: pending.device._id }))?.status).toBe("EXPIRED");
    });
  });

  describe("sessions", () => {
    it("revoke one session: it stops working, others are untouched", async () => {
      const a = await device();
      const b = await device();
      await mem.db.collection("SecurityAccount").updateOne({ _id: userId }, { $set: { maxConcurrentSessions: 2 } });
      const sa = await session(a.device._id);
      const sb = await session(b.device._id);
      expect(await act("SESSION_REVOKE", { sessionId: sa.session._id.toHexString() })).toMatchObject({ outcome: "REVOKED", applied: true });
      expect((await ctx(sa.sessionId, a.secret)).session).toBe("REVOKED");
      expect((await ctx(sb.sessionId, b.secret)).session).toBe("VALID");
      expect(await act("SESSION_REVOKE", { sessionId: sa.session._id.toHexString() })).toMatchObject({ outcome: "ALREADY_ENDED", applied: false });
      // Device stays trusted.
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: a.device._id }))?.status).toBe("TRUSTED");
    });

    it("force logout ends all sessions, covers an in-flight login, and allows new logins", async () => {
      const d = await device();
      const s = await session(d.device._id);
      const now = new Date();
      // A login that started just before the click and inserts afterwards.
      const inFlight = new Date(now.getTime() - 500);
      expect(await act("FORCE_LOGOUT", {}, { now })).toMatchObject({ outcome: "LOGGED_OUT", applied: true });
      const late = await session(d.device._id, userId, inFlight);
      expect((await ctx(s.sessionId, d.secret)).session).toBe("REVOKED");
      expect((await ctx(late.sessionId, d.secret)).session).toBe("REVOKED");
      const fresh = await session(d.device._id, userId, new Date(now.getTime() + 1000));
      expect((await ctx(fresh.sessionId, d.secret)).session).toBe("VALID");
      // Device trust is not touched.
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: d.device._id }))?.status).toBe("TRUSTED");
      expect(await mem.db.collection("SecurityEvent").countDocuments({ type: "SESSION_REVOKED", reasonCodes: "ADMIN_FORCE_LOGOUT" })).toBe(1);
    });

    it("force logout with nothing active is a no-op without audit", async () => {
      expect(await act("FORCE_LOGOUT")).toMatchObject({ outcome: "NO_ACTIVE_SESSIONS", applied: false });
      expect(await audits()).toHaveLength(0);
    });

    it("force logout racing logins: every session started before the cutoff is refused", async () => {
      await mem.db.collection("SecurityAccount").updateOne({ _id: userId }, { $set: { maxConcurrentSessions: 10 } }, { upsert: true });
      const devs = [await device(), await device(), await device()];
      for (const d of devs) await session(d.device._id);
      const now = new Date();
      const racing = await Promise.all([
        act("FORCE_LOGOUT", {}, { now }),
        ...devs.map((d) => session(d.device._id, userId, new Date(now.getTime() - 10))),
      ]);
      expect(racing[0]).toMatchObject({ ok: true, applied: true });
      for (let i = 0; i < devs.length; i += 1) {
        const s = racing[i + 1] as Awaited<ReturnType<typeof session>>;
        expect((await ctx(s.sessionId, devs[i].secret)).session).toBe("REVOKED");
      }
    });
  });

  describe("review flag", () => {
    async function flagMedium(at: Date) {
      for (let i = 0; i < 5; i += 1) {
        await recordSecurityEvent(mem.db, { type: "LOGIN_FAILED", actorType: "USER", userId, occurredAt: new Date(at.getTime() - (i + 1) * 60_000) });
      }
      await evaluateCustomerRisk(mem.db, userId, CONFIG, at);
    }

    it("clears independently, is audited, and the same evidence doesn't re-flag", async () => {
      const t = new Date();
      await flagMedium(t);
      expect((await account())?.review).toBeTruthy();
      expect(await act("REVIEW_CLEAR", {}, { now: new Date(t.getTime() + 1000) })).toMatchObject({ outcome: "CLEARED", applied: true });
      expect((await account())?.review).toBeNull();
      const riskBefore = await mem.db.collection("SecurityRiskAssessment").countDocuments();
      await evaluateCustomerRisk(mem.db, userId, CONFIG, new Date(t.getTime() + 2000));
      expect((await account())?.review).toBeNull();
      expect(await mem.db.collection("SecurityRiskAssessment").countDocuments()).toBeGreaterThanOrEqual(riskBefore);
      expect(await act("REVIEW_CLEAR")).toMatchObject({ outcome: "NOT_FLAGGED", applied: false });
      expect((await audits()).filter((a) => a.action === "REVIEW_CLEAR")).toHaveLength(1);
      // Newer evidence flags again.
      await flagMedium(new Date(t.getTime() + 10 * 60_000));
      expect((await account())?.review).toBeTruthy();
    });

    it("clearing review never lifts an active restriction", async () => {
      expect(await act("RESTRICTION_CREATE", { level: "CRITICAL" })).toMatchObject({ outcome: "RESTRICTED" });
      expect(await act("REVIEW_CLEAR")).toMatchObject({ outcome: "CLEARED" });
      const acc = await account();
      expect(acc?.restriction?.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(acc?.review).toBeNull();
    });

    it("clear racing a risk evaluation ends unflagged", async () => {
      const t = new Date();
      await flagMedium(t);
      const later = new Date(t.getTime() + 1000);
      await Promise.all([act("REVIEW_CLEAR", {}, { now: later }), evaluateCustomerRisk(mem.db, userId, CONFIG, later)]);
      await evaluateCustomerRisk(mem.db, userId, CONFIG, new Date(t.getTime() + 2000));
      expect((await account())?.review).toBeNull();
    });
  });

  describe("restrictions", () => {
    it("admin-created restrictions are temporary, never extended, and need the flag", async () => {
      expect(await act("RESTRICTION_CREATE", { level: "HIGH" }, { config: NO_RESTRICTIONS })).toMatchObject({ status: 409 });
      expect(await act("RESTRICTION_CREATE", { level: "FOREVER" })).toMatchObject({ status: 400 });
      const before = Date.now();
      expect(await act("RESTRICTION_CREATE", { level: "HIGH" })).toMatchObject({ outcome: "RESTRICTED", applied: true });
      const [doc] = await mem.db.collection("SecurityRestriction").find().toArray();
      expect(doc).toMatchObject({ source: "ADMIN", createdBy: adminId, level: "HIGH" });
      expect(doc.expiresAt.getTime() - before).toBeGreaterThan(23.9 * HOUR);
      expect(doc.expiresAt.getTime() - before).toBeLessThanOrEqual(24 * HOUR + 5000);
      expect(doc.createdActionId).toEqual((await audits())[0]._id);
      expect(await act("RESTRICTION_CREATE", { level: "CRITICAL" })).toMatchObject({ outcome: "ALREADY_RESTRICTED", applied: false });
      expect((await account())?.restriction.expiresAt).toEqual(doc.expiresAt);
    });

    it("concurrent admin restrictions: exactly one applies", async () => {
      const results = await Promise.all([
        act("RESTRICTION_CREATE", { level: "HIGH" }),
        act("RESTRICTION_CREATE", { level: "CRITICAL" }, { adminId: admin2Id.toHexString() }),
      ]);
      expect(results.filter((r) => r.ok && r.applied)).toHaveLength(1);
      expect(await mem.db.collection("SecurityRestriction").countDocuments({ status: "ACTIVE" })).toBe(1);
    });

    it("lift through the center, repeated lift is a no-op", async () => {
      await act("RESTRICTION_CREATE", { level: "HIGH" });
      const id = (await account())!.restriction.id.toHexString();
      expect(await act("RESTRICTION_LIFT", { restrictionId: id })).toMatchObject({ outcome: "REMOVED", applied: true });
      expect(await act("RESTRICTION_LIFT", { restrictionId: id })).toMatchObject({ outcome: "ALREADY_ENDED", applied: false });
    });
  });

  describe("limits", () => {
    it("validates bounds and types", async () => {
      for (const bad of [0, 11, 2.5, "3", -1, true]) {
        expect(await act("LIMITS_SET", { deviceLimit: bad })).toMatchObject({ ok: false, status: 400 });
      }
      expect(await act("LIMITS_SET", {})).toMatchObject({ status: 400 });
      expect(await audits()).toHaveLength(0);
    });

    it("sets, audits before/after, resets to default with null, and is idempotent", async () => {
      expect(await act("LIMITS_SET", { deviceLimit: 5, maxConcurrentSessions: 2 })).toMatchObject({ outcome: "UPDATED" });
      expect(await account()).toMatchObject({ deviceLimit: 5, maxConcurrentSessions: 2 });
      expect((await audits())[0].metadata).toEqual({
        before: { deviceLimit: null, maxConcurrentSessions: null },
        after: { deviceLimit: 5, maxConcurrentSessions: 2 },
      });
      expect(await act("LIMITS_SET", { deviceLimit: 5 })).toMatchObject({ outcome: "UNCHANGED", applied: false });
      expect(await act("LIMITS_SET", { deviceLimit: null })).toMatchObject({ outcome: "UPDATED" });
      expect((await account())?.deviceLimit).toBeNull();
      expect((await account())?.maxConcurrentSessions).toBe(2);
    });

    it("a lower device limit is enforced atomically under concurrent registrations", async () => {
      await act("LIMITS_SET", { deviceLimit: 2 });
      const results = await Promise.all(Array.from({ length: 10 }, () => registerDevice(mem.db, { userId }, CONFIG)));
      expect(results.filter((r) => r.outcome === "CREATED")).toHaveLength(2);
      // Lowering below current use removes no devices.
      await act("LIMITS_SET", { deviceLimit: 1 });
      expect(await mem.db.collection("SecurityDevice").countDocuments({ userId, status: { $ne: "REVOKED" } })).toBe(2);
    });

    it("a higher session limit lets two sessions coexist; lowering ends the oldest", async () => {
      const a = await device();
      const b = await device();
      await act("LIMITS_SET", { maxConcurrentSessions: 2 });
      const sa = await session(a.device._id);
      const sb = await session(b.device._id);
      expect((await ctx(sa.sessionId, a.secret)).session).toBe("VALID");
      await act("LIMITS_SET", { maxConcurrentSessions: 1 });
      expect((await ctx(sa.sessionId, a.secret)).session).toBe("EVICTED");
      expect((await ctx(sb.sessionId, b.secret)).session).toBe("VALID");
    });

    it("two admins changing limits at once: the stale one is refused", async () => {
      const results = await Promise.all([
        act("LIMITS_SET", { deviceLimit: 4 }),
        act("LIMITS_SET", { deviceLimit: 6 }, { adminId: admin2Id.toHexString() }),
      ]);
      const applied = results.filter((r) => r.ok && r.applied);
      expect(applied.length).toBeGreaterThanOrEqual(1);
      const finalLimit = (await account())?.deviceLimit;
      expect([4, 6]).toContain(finalLimit);
      for (const r of results) if (!(r.ok && r.applied)) expect(r).toMatchObject({ ok: false, status: 409 });
    });
  });

  describe("audit before change", () => {
    it.each([
      ["FORCE_LOGOUT", {}],
      ["REVIEW_CLEAR", {}],
      ["LIMITS_SET", { deviceLimit: 4 }],
      ["RESTRICTION_CREATE", { level: "HIGH" }],
    ])("%s changes nothing if the audit write fails", async (action, body) => {
      const d = await device();
      const s = await session(d.device._id);
      await mem.db.collection("SecurityAccount").updateOne({ _id: userId }, { $set: { review: { since: new Date(), source: "RISK_MEDIUM", restrictionId: null } } });
      const before = await account();
      const spy = breakAudit();
      await expect(act(action, body)).rejects.toThrow("audit down");
      spy.mockRestore();
      expect(await account()).toEqual(before);
      expect((await lookupSession(mem.db, s.sessionId)).state).toBe("VALID");
      expect(await mem.db.collection("SecurityRestriction").countDocuments()).toBe(0);
    });

    it("device and session revocation change nothing if the audit write fails", async () => {
      const d = await device();
      const s = await session(d.device._id);
      const spy = breakAudit();
      await expect(act("DEVICE_REVOKE", { deviceId: d.device._id.toHexString() })).rejects.toThrow("audit down");
      await expect(act("SESSION_REVOKE", { sessionId: s.session._id.toHexString() })).rejects.toThrow("audit down");
      spy.mockRestore();
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: d.device._id }))?.status).toBe("TRUSTED");
      expect((await lookupSession(mem.db, s.sessionId)).state).toBe("VALID");
    });
  });

  describe("read models", () => {
    it("detail covers every section and contains no secrets", async () => {
      await device();
      const pending = await device();
      const d2 = await mem.db.collection("SecurityDevice").findOne({ userId, status: "TRUSTED" });
      const s = await session(d2!._id);
      await recordSecurityEvent(mem.db, { type: "LOGIN_FAILED", actorType: "USER", userId, ip: "198.51.100.23" });
      await act("RESTRICTION_CREATE", { level: "HIGH" });
      const detail = await getCustomerSecurityDetail(mem.db, userId, CONFIG);
      expect(detail).toMatchObject({
        customer: { email: "c@example.com", isActive: true },
        status: { accountState: "RESTRICTED", limits: { deviceLimit: 3, maxConcurrentSessions: 1, bounds: { min: 1, max: 10 } } },
        restrictions: { active: { level: "HIGH" } },
      });
      expect(detail!.devices.map((d) => d.status).sort()).toEqual(["PENDING_VERIFICATION", "TRUSTED"]);
      expect(detail!.devices.find((d) => d.id === pending.device._id.toHexString())?.referenceCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(detail!.sessions[0]).toMatchObject({ status: "ACTIVE", ref: expect.stringMatching(/^[a-f0-9]{16}$/) });
      expect(detail!.events.find((e) => e.type === "LOGIN_FAILED")?.networkRef).toMatch(/^[a-f0-9]{8}$/);
      expect(detail!.adminActions[0]).toMatchObject({ action: "RESTRICTION_CREATE", admin: "a1@example.com" });

      const text = JSON.stringify(detail);
      for (const secret of [s.sessionId, pending.secret, ADMIN_PASSWORD, "198.51.100.23", "203.0.113.50"]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/passwordHash|secretHash|sessionIdHash|"ipHash"|\$2b\$/);
      const fullIpHash = (await mem.db.collection("SecurityEvent").findOne({ type: "LOGIN_FAILED" }))!.ipHash;
      expect(text).not.toContain(fullIpHash);
    });

    it("customer list summarises status without secrets", async () => {
      await device();
      await act("RESTRICTION_CREATE", { level: "CRITICAL" });
      const list = await listCustomerSecurity(mem.db);
      expect(list.map((c) => c.email).sort()).toEqual(["c@example.com", "o@example.com"]);
      expect(list.find((c) => c.email === "c@example.com")).toMatchObject({ restricted: true, restrictionLevel: "CRITICAL", reviewRequired: true, trustedDevices: 1 });
      expect(JSON.stringify(list)).not.toMatch(/passwordHash|a1@example.com/);
    });

    it("expired restrictions show as expired in history", async () => {
      await act("RESTRICTION_CREATE", { level: "HIGH" });
      const later = new Date(Date.now() + 25 * HOUR);
      const detail = await getCustomerSecurityDetail(mem.db, userId, CONFIG, later);
      expect(detail!.restrictions.active).toBeNull();
      expect(detail!.restrictions.history[0].status).toBe("EXPIRED");
      expect(detail!.status.accountState).toBe("ACTIVE");
    });
  });
});
