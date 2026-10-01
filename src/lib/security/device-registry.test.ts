import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSecurityConfig } from "@/lib/security/config";
import {
  generateDeviceSecret,
  hashDeviceSecret,
} from "@/lib/security/device";
import {
  deleteSecurityRecordsForUser,
  describeUserAgent,
  listDevices,
  normalizeDeviceLabel,
  recountDeviceSlots,
  registerDevice,
  renameDevice,
  revokeDevice,
  toDeviceView,
} from "@/lib/security/device-registry";
import { ensureIndexes } from "@/lib/security/indexes";
import { createServerSession, lookupSession } from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const env = (values: Record<string, string> = {}) =>
  ({ NODE_ENV: "test", SECURITY_DEVICE_TRUST_ENABLED: "detect", ...values }) as NodeJS.ProcessEnv;
const config = getSecurityConfig(env());
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

describe("device registry (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: ObjectId;
  const accounts = () => mem.db.collection("SecurityAccount");
  const devices = () => mem.db.collection("SecurityDevice");

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId();
  });

  async function register(deviceCookie?: string | null, user = userId, cfg = config) {
    return registerDevice(mem.db, { userId: user, deviceCookie, userAgent: CHROME_WIN }, cfg);
  }

  describe("registration", () => {
    it("registers a new device, storing only the secret's hash", async () => {
      const result = await register();
      expect(result.outcome).toBe("CREATED");
      if (result.outcome !== "CREATED") return;
      expect(result.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.device.secretHash).toBe(hashDeviceSecret(result.secret));
      expect(result.device).toMatchObject({ platform: "Windows", browserFamily: "Chrome" });
      const stored = JSON.stringify(await devices().find().toArray());
      expect(stored).not.toContain(result.secret);
    });

    it("reuses the device for the same valid cookie (no duplicates)", async () => {
      const first = await register();
      if (first.outcome !== "CREATED") throw new Error("expected CREATED");
      for (let i = 0; i < 3; i += 1) {
        const again = await register(first.secret);
        expect(again).toMatchObject({ outcome: "EXISTING", cookieRejected: null });
        if (again.outcome === "EXISTING") expect(again.device._id).toEqual(first.device._id);
      }
      expect(await devices().countDocuments()).toBe(1);
      expect((await accounts().findOne({ _id: userId }))?.deviceSlotsUsed).toBe(1);
    });

    it("rejects malformed and unknown cookies and registers a fresh device", async () => {
      const malformed = await register('{"$ne":null}');
      expect(malformed).toMatchObject({ outcome: "CREATED", cookieRejected: "MALFORMED" });
      const unknown = await register(generateDeviceSecret());
      expect(unknown).toMatchObject({ outcome: "CREATED", cookieRejected: "UNKNOWN" });
      // A hash is not a credential.
      if (malformed.outcome !== "CREATED") return;
      const hashAsCookie = await register(malformed.device.secretHash);
      expect(hashAsCookie.cookieRejected).toBe("MALFORMED");
    });

    it("never adopts another customer's device cookie", async () => {
      const other = await register(null, new ObjectId());
      if (other.outcome !== "CREATED") throw new Error("expected CREATED");
      const mine = await register(other.secret);
      expect(mine).toMatchObject({ outcome: "CREATED", cookieRejected: "OTHER_USER" });
      if (mine.outcome === "CREATED") expect(mine.device.userId).toEqual(userId);
    });

    it("does not revive a revoked device from its old cookie", async () => {
      const first = await register();
      if (first.outcome !== "CREATED") throw new Error("expected CREATED");
      await revokeDevice(mem.db, userId, first.device._id);

      const again = await register(first.secret);
      expect(again).toMatchObject({ outcome: "CREATED", cookieRejected: "REVOKED" });
      const old = await devices().findOne({ _id: first.device._id });
      expect(old?.status).toBe("REVOKED");
      if (again.outcome === "CREATED") {
        expect(again.device._id).not.toEqual(first.device._id);
        // Enrollment was already used: the replacement is not auto-trusted.
        expect(again.device.status).toBe("PENDING_VERIFICATION");
      }
    });
  });

  describe("grandfathering (one-time auto-trust)", () => {
    it("trusts the first device of an existing customer with no devices", async () => {
      expect(await accounts().findOne({ _id: userId })).toBeNull();
      const first = await register();
      expect(first).toMatchObject({ outcome: "CREATED", enrolled: true });
      if (first.outcome !== "CREATED") return;
      expect(first.device.status).toBe("TRUSTED");
      expect(first.device.verifiedAt).toBeInstanceOf(Date);
      const account = await accounts().findOne({ _id: userId });
      expect(account?.enrolledAt).toBeInstanceOf(Date);
      expect(account?.enrolledDeviceId).toEqual(first.device._id);
    });

    it("makes every later device pending", async () => {
      await register();
      const second = await register();
      expect(second).toMatchObject({ outcome: "CREATED", enrolled: false });
      if (second.outcome === "CREATED") expect(second.device.status).toBe("PENDING_VERIFICATION");
    });

    it("keeps the enrollment marker after all devices are revoked", async () => {
      const first = await register();
      const second = await register();
      if (first.outcome !== "CREATED" || second.outcome !== "CREATED") throw new Error();
      await revokeDevice(mem.db, userId, first.device._id);
      await revokeDevice(mem.db, userId, second.device._id);
      expect(await listDevices(mem.db, userId)).toHaveLength(0);

      const next = await register();
      expect(next).toMatchObject({ outcome: "CREATED", enrolled: false });
      if (next.outcome === "CREATED") expect(next.device.status).toBe("PENDING_VERIFICATION");
      expect((await accounts().findOne({ _id: userId }))?.enrolledAt).toBeInstanceOf(Date);
    });

    it("auto-trusts exactly one device when first logins race", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => register()));
      const created = results.filter((r) => r.outcome === "CREATED");
      expect(created.filter((r) => r.outcome === "CREATED" && r.enrolled)).toHaveLength(1);
      expect(await devices().countDocuments({ status: "TRUSTED" })).toBe(1);
    });
  });

  describe("device limit", () => {
    it("stops at the configured limit (default 3)", async () => {
      expect(config.limits.deviceLimit).toBe(3);
      const results = [];
      for (let i = 0; i < 5; i += 1) results.push(await register());
      expect(results.map((r) => r.outcome)).toEqual([
        "CREATED",
        "CREATED",
        "CREATED",
        "LIMIT_REACHED",
        "LIMIT_REACHED",
      ]);
      expect(await devices().countDocuments()).toBe(3);
    });

    it("uses the configured limit", async () => {
      const two = getSecurityConfig(env({ SECURITY_DEVICE_LIMIT: "2" }));
      const outcomes = [];
      for (let i = 0; i < 3; i += 1) outcomes.push((await register(null, userId, two)).outcome);
      expect(outcomes).toEqual(["CREATED", "CREATED", "LIMIT_REACHED"]);
    });

    it("cannot be bypassed by concurrent registrations", async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => register()));
      expect(results.filter((r) => r.outcome === "CREATED")).toHaveLength(3);
      expect(results.filter((r) => r.outcome === "LIMIT_REACHED")).toHaveLength(17);
      expect(await devices().countDocuments({ userId })).toBe(3);
      expect((await accounts().findOne({ _id: userId }))?.deviceSlotsUsed).toBe(3);
    });

    it("frees a slot on revoke, exactly once, even under concurrent revokes", async () => {
      const devs = [];
      for (let i = 0; i < 3; i += 1) devs.push(await register());
      const target = devs[0];
      if (target.outcome !== "CREATED") throw new Error();
      const revokes = await Promise.all(
        Array.from({ length: 5 }, () => revokeDevice(mem.db, userId, target.device._id)),
      );
      expect(revokes.filter((r) => r.state === "REVOKED")).toHaveLength(1);
      expect(revokes.filter((r) => r.state === "ALREADY_REVOKED")).toHaveLength(4);
      expect((await accounts().findOne({ _id: userId }))?.deviceSlotsUsed).toBe(2);
      expect((await register()).outcome).toBe("CREATED");
      expect((await register()).outcome).toBe("LIMIT_REACHED");
    });

    it("is counted in the database, independent of any client input", async () => {
      await register();
      await register();
      // Tampering with the counter is repaired from the real device records.
      await accounts().updateOne({ _id: userId }, { $set: { deviceSlotsUsed: 0 } });
      expect(await recountDeviceSlots(mem.db, userId)).toBe(2);
      expect((await accounts().findOne({ _id: userId }))?.deviceSlotsUsed).toBe(2);
    });
  });

  describe("lifecycle and ownership", () => {
    it("lists only the customer's own usable devices, without secrets", async () => {
      const mine = await register();
      await register(null, new ObjectId());
      const revoked = await register();
      if (mine.outcome !== "CREATED" || revoked.outcome !== "CREATED") throw new Error();
      await revokeDevice(mem.db, userId, revoked.device._id);

      const list = await listDevices(mem.db, userId);
      expect(list.map((d) => d._id)).toEqual([mine.device._id]);
      const view = toDeviceView(list[0], mine.device._id);
      expect(view).toEqual({
        id: mine.device._id.toHexString(),
        label: null,
        platform: "Windows",
        browserFamily: "Chrome",
        status: "TRUSTED",
        firstSeenAt: expect.any(String),
        lastSeenAt: expect.any(String),
        current: true,
      });
      expect(JSON.stringify(view)).not.toMatch(/secretHash|purgeAt|userId/);
      expect(JSON.stringify(view)).not.toContain(mine.device.secretHash);
    });

    it("renames own devices only", async () => {
      const mine = await register();
      const theirs = await register(null, new ObjectId());
      if (mine.outcome !== "CREATED" || theirs.outcome !== "CREATED") throw new Error();

      expect((await renameDevice(mem.db, userId, mine.device._id, "Work laptop"))?.label).toBe(
        "Work laptop",
      );
      expect(await renameDevice(mem.db, userId, theirs.device._id, "mine now")).toBeNull();
      expect((await devices().findOne({ _id: theirs.device._id }))?.label).toBeNull();
      expect(await renameDevice(mem.db, userId, "not-an-id", "x")).toBeNull();
    });

    it("revokes own devices only and revokes their sessions", async () => {
      const mine = await register();
      const theirs = await register(null, new ObjectId());
      if (mine.outcome !== "CREATED" || theirs.outcome !== "CREATED") throw new Error();
      const { sessionId } = await createServerSession(
        mem.db,
        { userId, deviceId: mine.device._id },
        config,
      );

      expect((await revokeDevice(mem.db, userId, theirs.device._id)).state).toBe("NOT_FOUND");
      expect((await devices().findOne({ _id: theirs.device._id }))?.status).toBe("TRUSTED");

      const result = await revokeDevice(mem.db, userId, mine.device._id);
      expect(result).toMatchObject({ state: "REVOKED", sessionsRevoked: 1 });
      expect((await lookupSession(mem.db, sessionId)).state).toBe("REVOKED");
      const stored = await devices().findOne({ _id: mine.device._id });
      expect(stored?.purgeAt).toBeInstanceOf(Date);
      // Revoked devices can't be renamed back into use.
      expect(await renameDevice(mem.db, userId, mine.device._id, "back")).toBeNull();
    });

    it("deletes a customer's security records on account deletion", async () => {
      await register();
      await register(null, new ObjectId());
      await deleteSecurityRecordsForUser(mem.db, userId);
      expect(await devices().countDocuments({ userId })).toBe(0);
      expect(await accounts().countDocuments({ _id: userId })).toBe(0);
      expect(await devices().countDocuments()).toBe(1);
    });
  });
});

describe("normalizeDeviceLabel", () => {
  it("cleans, bounds and rejects labels", () => {
    expect(normalizeDeviceLabel("  Home   laptop ")).toBe("Home laptop");
    expect(normalizeDeviceLabel("a\u0000b\nc")).toBe("a b c");
    expect(normalizeDeviceLabel("")).toBeNull();
    expect(normalizeDeviceLabel(null)).toBeNull();
    expect(normalizeDeviceLabel("x".repeat(41))).toBeUndefined();
    expect(normalizeDeviceLabel(42)).toBeUndefined();
    expect(normalizeDeviceLabel({ $set: 1 })).toBeUndefined();
  });
});

describe("describeUserAgent", () => {
  it("returns coarse descriptors only", () => {
    expect(describeUserAgent(CHROME_WIN)).toEqual({ platform: "Windows", browserFamily: "Chrome" });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ platform: "iOS", browserFamily: "Safari" });
    expect(describeUserAgent("")).toEqual({ platform: null, browserFamily: null });
    expect(describeUserAgent("curl/8.0")).toEqual({ platform: "Other", browserFamily: "Other" });
  });
});
