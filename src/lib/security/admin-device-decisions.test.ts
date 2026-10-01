import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { decidePendingDevice } from "@/lib/security/admin-device-decisions";
import { STEP_UP_MAX_FAILURES } from "@/lib/security/admin-step-up";
import { getSecurityConfig } from "@/lib/security/config";
import { registerDevice } from "@/lib/security/device-registry";
import { ensureIndexes } from "@/lib/security/indexes";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const ADMIN_PASSWORD = "AdminPass123";
const config = getSecurityConfig({
  NODE_ENV: "test",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_DEVICE_VERIFICATION_ENABLED: "on",
} as NodeJS.ProcessEnv);

describe("admin device decisions (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let adminId: ObjectId;
  let userId: ObjectId;
  let otherUserId: ObjectId;
  let pendingId: ObjectId;
  let pendingSecret: string;

  const actions = () => mem.db.collection("SecurityAdminAction");
  const events = () => mem.db.collection("SecurityEvent");
  const status = async (id = pendingId) => (await mem.db.collection("SecurityDevice").findOne({ _id: id }))?.status;

  beforeAll(async () => {
    mem = await startMemoryDb();
    vi.stubEnv("SESSION_SECRET", "decision-test-secret-0123456789");
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await mem?.stop();
  });
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    adminId = new ObjectId();
    userId = new ObjectId();
    otherUserId = new ObjectId();
    await mem.db.collection("User").insertMany([
      { _id: adminId, email: "admin@example.com", role: "SUPER_ADMIN", isActive: true, passwordHash: await hashPassword(ADMIN_PASSWORD) },
      { _id: userId, email: "c@example.com", name: "Cust", role: "USER", isActive: true },
      { _id: otherUserId, email: "o@example.com", name: "Other", role: "USER", isActive: true },
    ]);
    await registerDevice(mem.db, { userId }, config); // enrollment
    const pending = await registerDevice(mem.db, { userId }, config);
    if (pending.outcome !== "CREATED") throw new Error();
    pendingId = pending.device._id;
    pendingSecret = pending.secret;
  });

  const decide = (
    decision: "APPROVE" | "REJECT",
    overrides: Partial<Parameters<typeof decidePendingDevice>[2]> = {},
  ) =>
    decidePendingDevice(
      mem.db,
      decision,
      {
        adminId: adminId.toHexString(),
        deviceId: pendingId,
        userId,
        password: ADMIN_PASSWORD,
        reason: decision === "REJECT" ? "Customer did not recognise this device" : undefined,
        ip: "203.0.113.9",
        ...overrides,
      },
      config,
    );

  it("approves with step-up and writes the audit record before the change", async () => {
    const result = await decide("APPROVE");
    expect(result).toEqual({ ok: true, outcome: "TRUSTED" });
    const [audit] = await actions().find().toArray();
    expect(audit).toMatchObject({ action: "DEVICE_APPROVED", adminId, targetUserId: userId, reason: "Approved by administrator" });
    const device = await mem.db.collection("SecurityDevice").findOne({ _id: pendingId });
    expect(device?.decisionActionId).toEqual(audit._id);
    expect(audit.occurredAt.getTime()).toBeLessThanOrEqual(device!.verifiedAt.getTime());
    expect(await events().countDocuments({ type: "DEVICE_VERIFIED" })).toBe(1);
    expect(await events().countDocuments({ type: "ADMIN_STEP_UP_SUCCEEDED" })).toBe(1);
  });

  it("rejects with a required reason", async () => {
    expect(await decide("REJECT", { reason: "" })).toMatchObject({ ok: false, status: 400 });
    expect(await status()).toBe("PENDING_VERIFICATION");
    expect(await decide("REJECT")).toEqual({ ok: true, outcome: "REJECTED" });
    expect((await actions().findOne())?.action).toBe("DEVICE_REJECTED");
  });

  it("requires the admin's password on every decision", async () => {
    expect(await decide("APPROVE", { password: undefined })).toMatchObject({ ok: false, status: 400 });
    expect(await decide("APPROVE", { password: "wrong-password1" })).toMatchObject({ ok: false, status: 401 });
    expect(await status()).toBe("PENDING_VERIFICATION");
    expect(await actions().countDocuments()).toBe(0);
    expect(await events().countDocuments({ type: "ADMIN_STEP_UP_FAILED" })).toBe(1);
  });

  it("locks step-up after repeated failures, even with the right password", async () => {
    for (let i = 0; i < STEP_UP_MAX_FAILURES; i += 1) {
      expect(await decide("APPROVE", { password: `wrong-${i}-pass` })).toMatchObject({ status: 401 });
    }
    expect(await decide("APPROVE")).toMatchObject({ ok: false, status: 429 });
    expect(await status()).toBe("PENDING_VERIFICATION");
  });

  it("refuses non-admins and disabled admins", async () => {
    expect(await decide("APPROVE", { adminId: userId.toHexString() })).toMatchObject({ status: 401 });
    await mem.db.collection("User").updateOne({ _id: adminId }, { $set: { isActive: false } });
    expect(await decide("APPROVE")).toMatchObject({ status: 401 });
    expect(await status()).toBe("PENDING_VERIFICATION");
  });

  it("the device must belong to the named customer (no IDOR)", async () => {
    expect(await decide("APPROVE", { userId: otherUserId })).toMatchObject({ ok: false, status: 404 });
    expect(await decide("APPROVE", { deviceId: new ObjectId() })).toMatchObject({ status: 404 });
    expect(await decide("APPROVE", { deviceId: "../x" })).toMatchObject({ status: 404 });
    expect(await decide("APPROVE", { userId: adminId })).toMatchObject({ status: 404 });
    expect(await status()).toBe("PENDING_VERIFICATION");
    expect(await actions().countDocuments()).toBe(0);
  });

  it("repeated decisions are no-ops without extra audit rows", async () => {
    await decide("APPROVE");
    expect(await decide("APPROVE")).toEqual({ ok: true, outcome: "ALREADY_TRUSTED" });
    expect(await decide("REJECT")).toEqual({ ok: true, outcome: "ALREADY_TRUSTED" });
    expect(await actions().countDocuments()).toBe(1);
  });

  it("an expired request can't be approved", async () => {
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await decide("APPROVE", { now: later })).toEqual({ ok: true, outcome: "EXPIRED" });
    expect(await status()).toBe("EXPIRED");
    expect(await actions().countDocuments()).toBe(0);
  });

  it("if the audit write fails, nothing changes", async () => {
    const original = mem.db.collection.bind(mem.db);
    const spy = vi.spyOn(mem.db, "collection").mockImplementation(((name: string) => {
      const col = original(name);
      if (name === "SecurityAdminAction") {
        return { ...col, insertOne: async () => { throw new Error("audit store down"); } };
      }
      return col;
    }) as typeof mem.db.collection);
    await expect(decide("APPROVE")).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect(await status()).toBe("PENDING_VERIFICATION");
  });

  it("concurrent admin approve/reject apply exactly one decision", async () => {
    const results = await Promise.all([decide("APPROVE"), decide("REJECT"), decide("APPROVE")]);
    const applied = results.filter((r) => r.ok && (r.outcome === "TRUSTED" || r.outcome === "REJECTED"));
    expect(applied).toHaveLength(1);
    const device = await mem.db.collection("SecurityDevice").findOne({ _id: pendingId });
    const effective = await actions().findOne({ _id: device?.decisionActionId });
    expect(effective?.action).toBe(device?.status === "TRUSTED" ? "DEVICE_APPROVED" : "DEVICE_REJECTED");
  });

  it("never stores passwords, device secrets or raw IPs in events or audit", async () => {
    await decide("APPROVE", { password: "wrong-password1" });
    await decide("REJECT");
    const stored = JSON.stringify([await actions().find().toArray(), await events().find().toArray()]);
    for (const secret of [ADMIN_PASSWORD, "wrong-password1", pendingSecret, "203.0.113.9"]) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toMatch(/passwordHash|secretHash/);
  });
});
