import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdminAction,
  buildSecurityEvent,
  recordAdminAction,
  recordSecurityEvent,
  sanitizeMetadata,
} from "@/lib/security/events";
import { hashIp } from "@/lib/security/crypto";
import { generateOpaqueToken } from "@/lib/security/crypto";
import { hashSessionId, sessionRef } from "@/lib/security/session";
import { ensureIndexes } from "@/lib/security/indexes";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const SECRET = "test-session-secret-0123456789";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyIsInJvbGUiOiJVU0VSIn0.c2lnbmF0dXJlLXZhbHVl";
const API_KEY = "atl_AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const BCRYPT = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";

describe("buildSecurityEvent", () => {
  it("builds a structured, searchable event with retention", () => {
    const userId = new ObjectId();
    const occurredAt = new Date("2026-05-01T00:00:00Z");
    const event = buildSecurityEvent(
      {
        type: "LOGIN_SUCCESS",
        actorType: "USER",
        actorId: userId.toHexString(),
        userId,
        requestId: "req-123",
        reasonCodes: ["KNOWN_DEVICE", "bad code!", "lowercase"],
        metadata: { remember: true, attempts: 2 },
        occurredAt,
      },
      SECRET,
    );
    expect(event).toMatchObject({
      type: "LOGIN_SUCCESS",
      actorType: "USER",
      actorId: userId,
      userId,
      requestId: "req-123",
      reasonCodes: ["KNOWN_DEVICE"],
      metadata: { remember: true, attempts: 2 },
      occurredAt,
    });
    expect(event.expiresAt.toISOString()).toBe("2026-10-28T00:00:00.000Z"); // +180 days
  });

  it("rejects unknown event and actor types", () => {
    expect(() =>
      buildSecurityEvent({ type: "HACKED" as never, actorType: "USER" }, SECRET),
    ).toThrow();
    expect(() =>
      buildSecurityEvent({ type: "LOGIN_SUCCESS", actorType: "ROOT" as never }, SECRET),
    ).toThrow();
  });

  it("stores a keyed IP hash, never the raw IP", () => {
    const event = buildSecurityEvent(
      { type: "LOGIN_FAILED", actorType: "USER", ip: "203.0.113.7" },
      SECRET,
    );
    expect(event.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain("203.0.113.7");
    expect(hashIp("203.0.113.7", "another-secret-0123456789")).not.toBe(event.ipHash);
    expect(hashIp("203.0.113.7", undefined)).toBeNull();
  });

  it("accepts a safe session reference and rejects raw session ids or hashes", () => {
    const sessionId = generateOpaqueToken();
    const ok = buildSecurityEvent(
      { type: "SESSION_CREATED", actorType: "USER", sessionRef: sessionRef(sessionId) },
      SECRET,
    );
    expect(ok.sessionRef).toBe(sessionRef(sessionId));

    for (const unsafe of [sessionId, hashSessionId(sessionId), JWT]) {
      const event = buildSecurityEvent(
        { type: "SESSION_CREATED", actorType: "USER", sessionRef: unsafe },
        SECRET,
      );
      expect(event.sessionRef).toBeNull();
      expect(JSON.stringify(event)).not.toContain(unsafe);
    }
  });

  it("ignores malformed ids and request ids instead of storing them", () => {
    const event = buildSecurityEvent(
      {
        type: "ACCESS_DENIED",
        actorType: "USER",
        userId: '{"$ne":null}',
        deviceId: "123",
        requestId: "<script>alert(1)</script>",
      },
      SECRET,
    );
    expect(event.userId).toBeNull();
    expect(event.deviceId).toBeNull();
    expect(event.requestId).toBeNull();
  });
});

describe("metadata sanitization (no secret leakage)", () => {
  it("drops secret-named keys at any depth", () => {
    const clean = sanitizeMetadata({
      password: "hunter2",
      passwordHash: BCRYPT,
      token: "abc",
      sessionId: "abc",
      SESSION_SECRET: "x",
      otp: "123456",
      apiKey: "atl_x",
      cookie: "atelier_session=abc",
      authorization: "Bearer abc",
      nested: { refreshToken: "abc", keyHash: "abc", keep: "ok" },
      route: "/api/products",
    });
    expect(clean).toEqual({ nested: { keep: "ok" }, route: "/api/products" });
  });

  it("redacts credential-looking values under innocent keys", () => {
    const clean = sanitizeMetadata({
      note: JWT,
      ref: API_KEY,
      hash: BCRYPT,
      header: "Bearer something",
      opaque: generateOpaqueToken(),
      digest: "a".repeat(64),
      list: [JWT, "fine"],
      plain: "Chrome on Windows",
    });
    expect(clean).toEqual({
      note: "[REDACTED]",
      ref: "[REDACTED]",
      hash: "[REDACTED]",
      header: "[REDACTED]",
      opaque: "[REDACTED]",
      digest: "[REDACTED]",
      list: ["[REDACTED]", "fine"],
      plain: "Chrome on Windows",
    });
  });

  it("caps size and depth and drops non-serializable values", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const clean = sanitizeMetadata({
      deep,
      many,
      long: "x".repeat(1000),
      fn: () => 1,
      big: BigInt(1),
      nan: Number.NaN,
    });
    expect(JSON.stringify(clean).length).toBeLessThan(1000);
    expect((clean.long as string).length).toBeLessThanOrEqual(257);
    expect(Object.keys(clean.many as object)).toHaveLength(25);
    expect("fn" in clean).toBe(false);
    expect("big" in clean).toBe(false);
    expect(clean.nan).toBeNull();
    expect(JSON.stringify(clean.deep)).not.toContain('"e"');
  });

  it("never lets a secret through anywhere in a full event", () => {
    const sessionId = generateOpaqueToken();
    const secrets = [sessionId, JWT, API_KEY, BCRYPT, SECRET, "hunter2", "203.0.113.7"];
    const event = buildSecurityEvent(
      {
        type: "LOGIN_FAILED",
        actorType: "USER",
        sessionRef: sessionId,
        ip: "203.0.113.7",
        reasonCodes: [JWT, "BAD_PASSWORD"],
        metadata: {
          password: "hunter2",
          details: { jwt: JWT, header: `Bearer ${JWT}`, key: API_KEY },
          echo: sessionId,
          hash: BCRYPT,
          secretValue: SECRET,
        },
      },
      SECRET,
    );
    const serialized = JSON.stringify(event);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(event.reasonCodes).toEqual(["BAD_PASSWORD"]);
  });
});

describe("buildAdminAction", () => {
  it("requires an admin id, a valid action and a reason", () => {
    const adminId = new ObjectId();
    expect(() => buildAdminAction({ adminId: "x", action: "X", reason: "r" })).toThrow();
    expect(() =>
      buildAdminAction({ adminId, action: "remove restriction", reason: "r" }),
    ).toThrow();
    expect(() => buildAdminAction({ adminId, action: "RESTORE", reason: "  " })).toThrow();

    const doc = buildAdminAction(
      {
        adminId,
        action: "RESTRICTION_REMOVED",
        targetUserId: new ObjectId(),
        reason: "Verified legitimate customer",
        metadata: { token: "abc", restrictionId: "r1" },
      },
      SECRET,
    );
    expect(doc.reason).toBe("Verified legitimate customer");
    expect(doc.metadata).toEqual({ restrictionId: "r1" });
    expect("expiresAt" in doc).toBe(false); // audit is never TTL'd
  });
});

describe("event persistence (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
  });

  it("writes events that can be queried by user and by type", async () => {
    const userId = new ObjectId();
    expect(
      await recordSecurityEvent(mem.db, { type: "LOGIN_SUCCESS", actorType: "USER", userId }),
    ).toBe(true);
    await recordSecurityEvent(mem.db, { type: "LOGIN_FAILED", actorType: "USER", userId });
    await recordSecurityEvent(mem.db, {
      type: "LOGIN_FAILED",
      actorType: "USER",
      userId: new ObjectId(),
    });

    const events = mem.db.collection("SecurityEvent");
    expect(await events.countDocuments({ userId })).toBe(2);
    expect(await events.countDocuments({ type: "LOGIN_FAILED" })).toBe(2);

    const plan = await events
      .find({ userId })
      .sort({ occurredAt: -1 })
      .explain("queryPlanner");
    expect(JSON.stringify(plan)).toContain("event_userId_occurredAt");
  });

  it("fails open: a broken event returns false and logs no details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = await recordSecurityEvent(mem.db, {
      type: "NOT_A_TYPE" as never,
      actorType: "USER",
      metadata: { password: "hunter2" },
    });
    expect(ok).toBe(false);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("hunter2");
    spy.mockRestore();
  });

  it("stores admin actions in the TTL-free audit collection", async () => {
    await recordAdminAction(mem.db, {
      adminId: new ObjectId(),
      action: "SESSION_REVOKED",
      reason: "Customer request",
    });
    expect(await mem.db.collection("SecurityAdminAction").countDocuments()).toBe(1);
    const indexes = await mem.db.collection("SecurityAdminAction").listIndexes().toArray();
    expect(indexes.some((index) => "expireAfterSeconds" in index)).toBe(false);
  });
});
