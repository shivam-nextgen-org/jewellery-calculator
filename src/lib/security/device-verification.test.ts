import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSecurityConfig } from "@/lib/security/config";
import { evaluateSecurityContext } from "@/lib/security/context";
import { deviceReferenceCode } from "@/lib/security/device";
import {
  expirePendingDevice,
  expirePendingDevices,
  listDevices,
  registerDevice,
  revokeDevice,
} from "@/lib/security/device-registry";
import {
  customerDeviceState,
  listPendingDevices,
  rejectPendingDevice,
  trustPendingDevice,
} from "@/lib/security/device-verification";
import { ensureIndexes } from "@/lib/security/indexes";
import { lookupSession, startDeviceSession } from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const HOUR = 3_600_000;
const T0 = new Date("2026-10-01T10:00:00Z");
const config = getSecurityConfig({
  NODE_ENV: "test",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_DEVICE_VERIFICATION_ENABLED: "on",
  SECURITY_SESSIONS_ENABLED: "shadow",
  SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
} as NodeJS.ProcessEnv);

describe("device verification (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: ObjectId;
  const adminId = new ObjectId();
  const devices = () => mem.db.collection("SecurityDevice");
  const slots = async () =>
    (await mem.db.collection("SecurityAccount").findOne({ _id: userId }))?.deviceSlotsUsed;

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId();
    await mem.db.collection("User").insertOne({ _id: userId, name: "Cust", email: "c@example.com", role: "USER" });
  });

  async function register(now = T0, cookie?: string | null, user = userId) {
    return registerDevice(mem.db, { userId: user, deviceCookie: cookie, now }, config);
  }

  /** First device is auto-trusted (enrollment); returns a second, pending one. */
  async function pendingDevice(now = T0) {
    await register(now);
    const result = await register(now);
    if (result.outcome !== "CREATED") throw new Error("expected CREATED");
    return result;
  }

  const approve = (deviceId: unknown, now = new Date(T0.getTime() + HOUR), user: unknown = userId) =>
    trustPendingDevice(
      mem.db,
      { userId: user, deviceId, decidedBy: adminId, actionId: new ObjectId(), method: "ADMIN_APPROVAL", now },
      config,
    );
  const reject = (deviceId: unknown, now = new Date(T0.getTime() + HOUR), user: unknown = userId) =>
    rejectPendingDevice(mem.db, { userId: user, deviceId, decidedBy: adminId, actionId: new ObjectId(), now }, config);

  describe("pending devices", () => {
    it("are created with a 24h deadline and keep enrollment unchanged", async () => {
      const first = await register();
      expect(first).toMatchObject({ outcome: "CREATED", enrolled: true });
      if (first.outcome === "CREATED") {
        expect(first.device).toMatchObject({ status: "TRUSTED", verificationMethod: "ENROLLMENT", pendingExpiresAt: null });
      }
      const pending = await pendingDevice();
      expect(pending.device.status).toBe("PENDING_VERIFICATION");
      expect(pending.device.pendingExpiresAt?.getTime()).toBe(T0.getTime() + 24 * HOUR);
    });

    it("never become trusted because the customer logs in again", async () => {
      const pending = await pendingDevice();
      for (let i = 1; i <= 3; i += 1) {
        const again = await register(new Date(T0.getTime() + i * HOUR), pending.secret);
        expect(again).toMatchObject({ outcome: "EXISTING" });
        if (again.outcome === "EXISTING") expect(again.device.status).toBe("PENDING_VERIFICATION");
      }
      // Re-login does not extend the deadline either.
      expect((await devices().findOne({ _id: pending.device._id }))?.pendingExpiresAt).toEqual(
        pending.device.pendingExpiresAt,
      );
    });
  });

  describe("approval", () => {
    it("trusts a pending device and records who and how", async () => {
      const pending = await pendingDevice();
      const result = await approve(pending.device._id);
      expect(result.outcome).toBe("TRUSTED");
      expect(result.device).toMatchObject({
        status: "TRUSTED",
        verificationMethod: "ADMIN_APPROVAL",
        decidedBy: adminId,
        pendingExpiresAt: null,
      });
      expect(await slots()).toBe(2); // slot was already held while pending
    });

    it("is idempotent", async () => {
      const pending = await pendingDevice();
      expect((await approve(pending.device._id)).outcome).toBe("TRUSTED");
      expect((await approve(pending.device._id)).outcome).toBe("ALREADY_TRUSTED");
      expect((await reject(pending.device._id)).outcome).toBe("ALREADY_TRUSTED");
    });

    it("rejects the wrong customer, malformed ids and other customers' devices", async () => {
      const pending = await pendingDevice();
      expect((await approve(pending.device._id, undefined, new ObjectId())).outcome).toBe("NOT_FOUND");
      expect((await approve("not-an-id")).outcome).toBe("NOT_FOUND");
      expect((await approve({ $ne: null })).outcome).toBe("NOT_FOUND");
      expect((await approve(new ObjectId())).outcome).toBe("NOT_FOUND");
      expect((await devices().findOne({ _id: pending.device._id }))?.status).toBe("PENDING_VERIFICATION");
    });

    it("can't trust a device the customer revoked", async () => {
      const pending = await pendingDevice();
      await revokeDevice(mem.db, userId, pending.device._id, new Date(T0.getTime() + HOUR));
      expect((await approve(pending.device._id)).outcome).toBe("REVOKED");
      expect((await devices().findOne({ _id: pending.device._id }))?.status).toBe("REVOKED");
    });
  });

  describe("rejection", () => {
    it("revokes the device, frees its slot and ends its sessions", async () => {
      const pending = await pendingDevice();
      const session = await startDeviceSession(mem.db, { userId, deviceId: pending.device._id, now: T0 }, config);
      expect(await slots()).toBe(2);
      const result = await reject(pending.device._id);
      expect(result.outcome).toBe("REJECTED");
      expect(result.device).toMatchObject({ status: "REVOKED", revokedReason: "ADMIN_REJECTED", decidedBy: adminId });
      expect(await slots()).toBe(1);
      expect((await lookupSession(mem.db, session!.sessionId)).state).toBe("REVOKED");
    });

    it("is idempotent and frees the slot only once", async () => {
      const pending = await pendingDevice();
      expect((await reject(pending.device._id)).outcome).toBe("REJECTED");
      expect((await reject(pending.device._id)).outcome).toBe("ALREADY_REJECTED");
      expect((await approve(pending.device._id)).outcome).toBe("ALREADY_REJECTED");
      expect(await slots()).toBe(1);
    });

    it("a replayed rejected cookie gets a new pending device, never the old one", async () => {
      const pending = await pendingDevice();
      await reject(pending.device._id);
      const replay = await register(new Date(T0.getTime() + 2 * HOUR), pending.secret);
      expect(replay).toMatchObject({ outcome: "CREATED", cookieRejected: "REVOKED" });
      if (replay.outcome === "CREATED") expect(replay.device.status).toBe("PENDING_VERIFICATION");
      expect((await devices().findOne({ _id: pending.device._id }))?.status).toBe("REVOKED");
    });
  });

  describe("expiry (24h)", () => {
    it("can't be approved or rejected at or after the deadline", async () => {
      const pending = await pendingDevice();
      const deadline = new Date(T0.getTime() + 24 * HOUR);
      expect((await approve(pending.device._id, deadline)).outcome).toBe("EXPIRED");
      expect((await reject(pending.device._id, deadline)).outcome).toBe("EXPIRED");
      const stored = await devices().findOne({ _id: pending.device._id });
      expect(stored?.status).toBe("EXPIRED");
      expect(stored?.purgeAt).toBeInstanceOf(Date);
      expect(await slots()).toBe(1);
    });

    it("can be approved one millisecond before the deadline", async () => {
      const pending = await pendingDevice();
      const justBefore = new Date(T0.getTime() + 24 * HOUR - 1);
      expect((await approve(pending.device._id, justBefore)).outcome).toBe("TRUSTED");
    });

    it("expires overdue requests in bulk, freeing slots exactly once", async () => {
      await register();
      await register();
      await register();
      expect(await slots()).toBe(3);
      const later = new Date(T0.getTime() + 25 * HOUR);
      const results = await Promise.all([
        expirePendingDevices(mem.db, later, config),
        expirePendingDevices(mem.db, later, config),
      ]);
      expect(results[0] + results[1]).toBe(2);
      expect(await slots()).toBe(1);
      expect(await devices().countDocuments({ status: "EXPIRED" })).toBe(2);
    });

    it("frees expired slots before enforcing the device limit", async () => {
      await register();
      await register();
      await register();
      expect((await register()).outcome).toBe("LIMIT_REACHED");
      const later = new Date(T0.getTime() + 25 * HOUR);
      expect((await register(later)).outcome).toBe("CREATED");
      expect(await slots()).toBe(2);
    });

    it("a replayed expired cookie can't revive or extend the request", async () => {
      const pending = await pendingDevice();
      const later = new Date(T0.getTime() + 25 * HOUR);
      const replay = await register(later, pending.secret);
      expect(replay).toMatchObject({ outcome: "CREATED", cookieRejected: "EXPIRED" });
      expect((await devices().findOne({ _id: pending.device._id }))?.status).toBe("EXPIRED");
      expect((await approve(pending.device._id, later)).outcome).toBe("EXPIRED");
    });

    it("hides expired requests from the customer's list and the admin queue", async () => {
      await pendingDevice();
      const later = new Date(T0.getTime() + 25 * HOUR);
      expect((await listDevices(mem.db, userId, later, config)).map((d) => d.status)).toEqual(["TRUSTED"]);
      expect(await listPendingDevices(mem.db, later, config)).toEqual([]);
    });

    it("devices created before I3 (no pendingExpiresAt) use createdAt + 24h", async () => {
      const pending = await pendingDevice();
      await devices().updateOne({ _id: pending.device._id }, { $unset: { pendingExpiresAt: "" } });
      expect(await expirePendingDevice(mem.db, pending.device._id, new Date(T0.getTime() + 23 * HOUR), config)).toBe(false);
      expect(await expirePendingDevice(mem.db, pending.device._id, new Date(T0.getTime() + 24 * HOUR), config)).toBe(true);
    });
  });

  describe("races", () => {
    it("concurrent approve and reject: exactly one decision wins", { timeout: 60_000 }, async () => {
      for (let round = 0; round < 5; round += 1) {
        await mem.reset();
        await ensureIndexes(mem.db, "apply");
        const pending = await pendingDevice();
        const results = await Promise.all([
          approve(pending.device._id),
          reject(pending.device._id),
          approve(pending.device._id),
          reject(pending.device._id),
        ]);
        const applied = results.filter((r) => r.outcome === "TRUSTED" || r.outcome === "REJECTED");
        expect(applied).toHaveLength(1);
        const final = await devices().findOne({ _id: pending.device._id });
        const expectedSlots = final?.status === "TRUSTED" ? 2 : 1;
        expect(await slots()).toBe(expectedSlots);
        for (const r of results) {
          if (r !== applied[0]) expect(r.outcome).toMatch(/^ALREADY_/);
        }
      }
    });

    it("concurrent expiry and approval at the deadline: expiry wins deterministically", async () => {
      const pending = await pendingDevice();
      const deadline = new Date(T0.getTime() + 24 * HOUR);
      const [approval, expired] = await Promise.all([
        approve(pending.device._id, deadline),
        expirePendingDevice(mem.db, pending.device._id, deadline, config),
      ]);
      expect(approval.outcome).toBe("EXPIRED");
      expect(typeof expired).toBe("boolean");
      expect((await devices().findOne({ _id: pending.device._id }))?.status).toBe("EXPIRED");
      expect(await slots()).toBe(1);
    });

    it("concurrent approvals trust once and keep the device limit", async () => {
      const pending = await pendingDevice();
      const results = await Promise.all(Array.from({ length: 10 }, () => approve(pending.device._id)));
      expect(results.filter((r) => r.outcome === "TRUSTED")).toHaveLength(1);
      expect(await slots()).toBe(2);
    });
  });

  describe("customer-facing state", () => {
    it("reports pending with the same reference code the admin sees", async () => {
      const pending = await pendingDevice();
      const state = await customerDeviceState(mem.db, userId.toHexString(), pending.secret, T0, config);
      expect(state).toEqual({
        state: "PENDING",
        referenceCode: deviceReferenceCode(pending.device._id),
        expiresAt: new Date(T0.getTime() + 24 * HOUR).toISOString(),
      });
      const queue = await listPendingDevices(mem.db, T0, config);
      expect(queue).toEqual([
        expect.objectContaining({
          id: pending.device._id.toHexString(),
          userId: userId.toHexString(),
          customerEmail: "c@example.com",
          referenceCode: deviceReferenceCode(pending.device._id),
        }),
      ]);
      expect(JSON.stringify(queue)).not.toMatch(/secretHash|passwordHash/);
    });

    it("reports expired, rejected, trusted and unknown", async () => {
      const pending = await pendingDevice();
      const uid = userId.toHexString();
      expect((await customerDeviceState(mem.db, uid, pending.secret, new Date(T0.getTime() + 25 * HOUR), config)).state).toBe("EXPIRED");
      await reject(pending.device._id);
      expect((await customerDeviceState(mem.db, uid, pending.secret, T0, config)).state).toBe("REJECTED");
      expect((await customerDeviceState(mem.db, new ObjectId().toHexString(), pending.secret, T0, config)).state).toBe("UNKNOWN");
      expect((await customerDeviceState(mem.db, uid, "garbage", T0, config)).state).toBe("UNKNOWN");
    });

    it("request context: pending is UNTRUSTED, overdue is EXPIRED, approved is MATCH", async () => {
      const pending = await pendingDevice();
      const s = await startDeviceSession(mem.db, { userId, deviceId: pending.device._id, now: T0 }, config);
      const evaluate = (now: Date) =>
        evaluateSecurityContext(
          mem.db,
          { userId: userId.toHexString(), issuedAt: T0, cookies: { sid: s!.sessionId, device: pending.secret } },
          config,
          now,
        );
      expect((await evaluate(new Date(T0.getTime() + HOUR))).device).toBe("UNTRUSTED");
      expect((await evaluate(new Date(T0.getTime() + 25 * HOUR))).device).toBe("EXPIRED");
      await approve(pending.device._id);
      // Approval applies to the existing session without a re-login.
      expect(await evaluate(new Date(T0.getTime() + 2 * HOUR))).toMatchObject({ session: "VALID", device: "MATCH" });
    });
  });
});
