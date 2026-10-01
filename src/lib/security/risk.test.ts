import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSecurityConfig } from "@/lib/security/config";
import { recordSecurityEvent, type SecurityEventInput } from "@/lib/security/events";
import { ensureIndexes } from "@/lib/security/indexes";
import { evaluateCustomerRisk, evaluateCustomerRiskSafely, getCustomerRisk } from "@/lib/security/risk";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const LOG_ONLY = getSecurityConfig({ NODE_ENV: "test", SECURITY_RISK_ENGINE_ENABLED: "log-only" } as NodeJS.ProcessEnv);
const OFF = getSecurityConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const NOW = new Date("2026-10-01T12:00:00Z");
const MIN = 60_000;

describe("risk evaluation service (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: ObjectId;
  const history = () => mem.db.collection("SecurityRiskAssessment");
  const events = () => mem.db.collection("SecurityEvent");

  beforeAll(async () => {
    mem = await startMemoryDb();
    vi.stubEnv("SESSION_SECRET", "risk-test-secret-0123456789");
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await mem?.stop();
  });
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId();
    await mem.db.collection("User").insertOne({ _id: userId, role: "USER", email: "c@example.com" });
  });

  const record = (input: Omit<SecurityEventInput, "actorType" | "userId">, minutesAgo = 1) =>
    recordSecurityEvent(mem.db, {
      actorType: "SYSTEM",
      userId,
      occurredAt: new Date(NOW.getTime() - minutesAgo * MIN),
      ...input,
    });
  async function mismatchAndFailures() {
    await record({ type: "SESSION_DEVICE_MISMATCH" });
    for (let i = 0; i < 5; i += 1) await record({ type: "LOGIN_FAILED", ip: "203.0.113.5" }, i + 2);
  }

  it("feature flag off: nothing is read or written", async () => {
    await mismatchAndFailures();
    expect(await evaluateCustomerRisk(mem.db, userId, OFF, NOW)).toBeNull();
    expect(await history().countDocuments()).toBe(0);
    expect(await getCustomerRisk(mem.db, userId)).toBeNull();
  });

  it("a customer with nothing detected gets no records (existing customers unaffected)", async () => {
    const r = await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    expect(r).toMatchObject({ changed: false, result: { tier: "LOW", reasonCodes: [] } });
    expect(await history().countDocuments()).toBe(0);
    expect(await mem.db.collection("SecurityAccount").countDocuments()).toBe(0);
  });

  it("log-only: records an explainable assessment and the current risk, blocks nothing", async () => {
    await mismatchAndFailures();
    const r = await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    expect(r?.changed).toBe(true);
    const [doc] = await history().find().toArray();
    expect(doc).toMatchObject({
      userId,
      mode: "log-only",
      tier: "HIGH",
      previousTier: null,
      recommendedAction: "RESTRICT",
      reasonCodes: ["SESSION_DEVICE_MISMATCH", "LOGIN_FAILURE_BURST"],
      signals: expect.objectContaining({ mismatches: 1, loginFailures: 5 }),
      rulesetVersion: expect.stringMatching(/^risk-v1\./),
    });
    expect(doc.contributions).toEqual([
      { code: "SESSION_DEVICE_MISMATCH", weight: 30, value: 1, threshold: 1 },
      { code: "LOGIN_FAILURE_BURST", weight: 20, value: 5, threshold: 5 },
    ]);
    expect(doc.expiresAt.getTime() - NOW.getTime()).toBe(180 * 86_400_000);
    expect(await getCustomerRisk(mem.db, userId)).toMatchObject({ tier: "HIGH", assessmentId: doc._id });
    expect(await events().countDocuments({ type: "RISK_EVALUATED" })).toBe(1);
    expect(await events().countDocuments({ type: "RISK_ESCALATED" })).toBe(1);
  });

  it("is idempotent: re-evaluating the same situation writes nothing new", async () => {
    await mismatchAndFailures();
    await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    for (let i = 1; i <= 3; i += 1) {
      const r = await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, new Date(NOW.getTime() + i * 1000));
      expect(r?.changed).toBe(false);
    }
    expect(await history().countDocuments()).toBe(1);
    expect(await events().countDocuments({ type: "RISK_EVALUATED" })).toBe(1);
  });

  it("concurrent evaluations of the same state produce one record", async () => {
    await mismatchAndFailures();
    const results = await Promise.all(Array.from({ length: 8 }, () => evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW)));
    expect(results.filter((r) => r?.changed)).toHaveLength(1);
    expect(await history().countDocuments()).toBe(1);
  });

  it("an older evaluation can't overwrite a newer one", async () => {
    await mismatchAndFailures();
    await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    // Events age out; a later evaluation lowers risk.
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, later);
    expect((await getCustomerRisk(mem.db, userId))?.tier).toBe("LOW");
    // A stale evaluation (earlier clock) arriving late changes nothing.
    const stale = await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    expect(stale?.changed).toBe(false);
    expect((await getCustomerRisk(mem.db, userId))?.tier).toBe("LOW");
  });

  it("de-escalation is recorded (reversible), without a RISK_ESCALATED event", async () => {
    await mismatchAndFailures();
    await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    const r = await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, new Date(NOW.getTime() + 2 * 86_400_000));
    expect(r).toMatchObject({ changed: true, previousTier: "HIGH", result: { tier: "LOW" } });
    expect(await history().countDocuments()).toBe(2);
    expect(await events().countDocuments({ type: "RISK_ESCALATED" })).toBe(1);
  });

  it("ignores admins, unknown and malformed ids", async () => {
    const adminId = new ObjectId();
    await mem.db.collection("User").insertOne({ _id: adminId, role: "SUPER_ADMIN" });
    expect(await evaluateCustomerRisk(mem.db, adminId, LOG_ONLY, NOW)).toBeNull();
    expect(await evaluateCustomerRisk(mem.db, new ObjectId(), LOG_ONLY, NOW)).toBeNull();
    expect(await evaluateCustomerRisk(mem.db, '{"$ne":null}', LOG_ONLY, NOW)).toBeNull();
  });

  it("only reads this customer's events", async () => {
    const other = new ObjectId();
    await recordSecurityEvent(mem.db, { type: "SESSION_DEVICE_MISMATCH", actorType: "SYSTEM", userId: other, occurredAt: NOW });
    const r = await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    expect(r?.result.signals.mismatches).toBe(0);
  });

  it("stores counts and codes only: no IPs, hashes, device ids or session refs", async () => {
    await record({ type: "SESSION_CREATED", deviceId: new ObjectId(), ip: "198.51.100.7", sessionRef: "0123456789abcdef" });
    await mismatchAndFailures();
    await evaluateCustomerRisk(mem.db, userId, LOG_ONLY, NOW);
    const stored = JSON.stringify([await history().find().toArray(), await mem.db.collection("SecurityAccount").find().toArray()]);
    expect(stored).not.toContain("198.51.100.7");
    expect(stored).not.toContain("203.0.113.5");
    expect(stored).not.toContain("0123456789abcdef");
    expect(stored).not.toMatch(/ipHash|sessionRef|deviceId/);
  });

  it("fails open: a database error doesn't throw from the safe wrapper", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { collection: () => { throw new Error("db down: mongodb+srv://user:pw@host"); } } as never;
    await expect(evaluateCustomerRiskSafely(broken, userId, LOG_ONLY, NOW)).resolves.toBeUndefined();
    expect(spy.mock.calls.flat().join(" ")).not.toContain("pw@host");
    spy.mockRestore();
  });
});
