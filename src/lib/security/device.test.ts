import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSecurityConfig } from "@/lib/security/config";
import {
  createPendingDevice,
  DEVICE_COOKIE,
  deviceCookieOptions,
  devicePurgeDate,
  findDeviceBySecret,
  generateDeviceSecret,
  hashDeviceSecret,
  isDeviceTrusted,
  parseDeviceCookie,
} from "@/lib/security/device";
import { ensureIndexes } from "@/lib/security/indexes";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

describe("device secret generation", () => {
  it("is 256-bit base64url with no structure", () => {
    const secret = generateDeviceSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
  });

  it("does not repeat and shows no shared prefix across many draws", () => {
    const secrets = Array.from({ length: 5000 }, generateDeviceSecret);
    expect(new Set(secrets).size).toBe(secrets.length);
    const prefixes = new Set(secrets.map((s) => s.slice(0, 4)));
    expect(prefixes.size).toBeGreaterThan(4000);
  });

  it("stores only a hash that differs from the secret", () => {
    const secret = generateDeviceSecret();
    const hash = hashDeviceSecret(secret);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(secret);
    expect(hashDeviceSecret(secret)).toBe(hash);
  });
});

describe("device cookie validation", () => {
  it("accepts only well-formed secrets", () => {
    const secret = generateDeviceSecret();
    expect(parseDeviceCookie(secret)).toBe(secret);
    for (const bad of [
      undefined,
      null,
      "",
      "short",
      `${secret}x`,
      secret.slice(1),
      `${secret.slice(0, 42)}=`,
      `${secret.slice(0, 42)} `,
      "../../etc/passwd..................................",
      '{"$ne":null}',
    ]) {
      expect(parseDeviceCookie(bad as string)).toBeNull();
    }
  });

  it("uses the approved cookie properties", () => {
    const options = deviceCookieOptions(
      getSecurityConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    );
    expect(DEVICE_COOKIE).toBe("atelier_device");
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
    });
  });

  it("follows the shared COOKIE_SECURE override", () => {
    const options = deviceCookieOptions(
      getSecurityConfig({ NODE_ENV: "production", COOKIE_SECURE: "false" } as NodeJS.ProcessEnv),
    );
    expect(options.secure).toBe(false);
    expect(options.httpOnly).toBe(true);
  });

  it("purges revoked devices after the approved retention", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(devicePurgeDate(from).toISOString()).toBe("2027-02-05T00:00:00.000Z");
  });
});

describe("device store (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
  });

  it("creates a pending device and finds it only by the raw secret", async () => {
    const userId = new ObjectId();
    const { device, secret } = await createPendingDevice(mem.db, {
      userId,
      platform: "  Windows  ",
      browserFamily: "Chrome",
    });

    expect(device.status).toBe("PENDING_VERIFICATION");
    expect(isDeviceTrusted(device)).toBe(false);
    expect(device.platform).toBe("Windows");

    const stored = await mem.db.collection("SecurityDevice").findOne({ _id: device._id });
    expect(JSON.stringify(stored)).not.toContain(secret);

    expect((await findDeviceBySecret(mem.db, secret))?._id).toEqual(device._id);
    expect(await findDeviceBySecret(mem.db, device.secretHash)).toBeNull();
    expect(await findDeviceBySecret(mem.db, generateDeviceSecret())).toBeNull();
    expect(await findDeviceBySecret(mem.db, "not-a-secret")).toBeNull();
  });

  it("rejects a malformed user id", async () => {
    await expect(createPendingDevice(mem.db, { userId: "123" })).rejects.toThrow(
      /Invalid userId/,
    );
  });

  it("enforces unique secret hashes at the database level", async () => {
    const { device } = await createPendingDevice(mem.db, { userId: new ObjectId() });
    await expect(
      mem.db.collection("SecurityDevice").insertOne({
        ...device,
        _id: new ObjectId(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
