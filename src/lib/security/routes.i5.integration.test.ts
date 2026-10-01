import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

/**
 * I5 end to end: real login route + I4 concurrency + risk evaluation after
 * the response. Only the cookie jar and DB connection are swapped.
 */
const h = vi.hoisted(() => ({
  db: null as Db | null,
  jar: new Map<string, string>(),
  headers: new Headers(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
    delete: (name: string) => void h.jar.delete(name),
  }),
  headers: async () => h.headers,
}));

vi.mock("@/lib/mongo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mongo")>()),
  getDb: async () => {
    if (!h.db) throw new Error("test db not ready");
    return h.db;
  },
}));

const { POST: login } = await import("@/app/api/auth/login/route");
const { requireUser } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/auth/password");
const { drainBackgroundTasks } = await import("@/lib/security/background");
const { ensureIndexes } = await import("@/lib/security/indexes");

const PASSWORD = "Customer123";
const ON = {
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "enforce",
  SECURITY_CONCURRENCY_ENABLED: "enforce",
  SECURITY_DEVICE_LIMIT: "10",
  SECURITY_RISK_ENGINE_ENABLED: "log-only",
};

let ip = 0;
function loginRequest(email: string, password = PASSWORD, extraHeaders: Record<string, string> = {}) {
  ip += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.20.${Math.floor(ip / 250)}.${ip % 250}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ email, password }),
  });
}

const browsers: Record<string, Map<string, string>> = {};
function switchBrowser(name: string) {
  browsers[name] ??= new Map();
  h.jar = browsers[name];
}

describe("I5 risk engine through the real login route", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let customer: { _id: ObjectId; email: string };

  beforeAll(async () => {
    mem = await startMemoryDb("route_i5_test");
    h.db = mem.db;
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", "integration-test-secret-0123456789");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SECURITY_SESSIONS_CUTOVER_AT", "2026-01-01T00:00:00Z");
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    for (const key of Object.keys(browsers)) delete browsers[key];
    customer = { _id: new ObjectId(), email: "cust@example.com" };
    const now = new Date();
    await mem.db.collection("User").insertOne({
      ...customer, name: "Cust", role: "USER", isActive: true,
      passwordHash: await hashPassword(PASSWORD), createdAt: now, updatedAt: now,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  const setEnv = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  };
  async function loginOn(browser: string, headers: Record<string, string> = {}) {
    switchBrowser(browser);
    expect((await login(loginRequest(customer.email, PASSWORD, headers))).status).toBe(200);
    await drainBackgroundTasks();
  }
  const risk = async () => (await mem.db.collection("SecurityAccount").findOne({ _id: customer._id }))?.risk;

  it("flags off: no failure events, no risk records, same responses", async () => {
    switchBrowser("x");
    expect((await login(loginRequest(customer.email, "WrongPass1"))).status).toBe(401);
    await loginOn("laptop");
    await drainBackgroundTasks();
    expect(await mem.db.collection("SecurityEvent").countDocuments()).toBe(0);
    expect(await mem.db.collection("SecurityRiskAssessment").countDocuments()).toBe(0);
  });

  it("normal use (laptop, then phone) is LOW and records nothing", async () => {
    setEnv(ON);
    await loginOn("laptop");
    await loginOn("phone");
    expect(await risk()).toBeUndefined();
    expect(await mem.db.collection("SecurityRiskAssessment").countDocuments()).toBe(0);
  });

  it("ping-pong between two browsers is detected, explained, and nothing extra is blocked", async () => {
    setEnv(ON);
    for (const name of ["a", "b", "a", "b", "a", "b"]) await loginOn(name);
    const state = await risk();
    expect(state?.reasonCodes).toEqual(expect.arrayContaining(["RAPID_SESSION_EVICTION", "DEVICE_PING_PONG"]));
    expect(state?.tier).toBe("HIGH");
    expect(state?.recommendedAction).toBe("RESTRICT");
    // Advisory only: the newest session still works (I4 behaviour unchanged).
    switchBrowser("b");
    await expect(requireUser()).resolves.toBeTruthy();
  });

  it("wrong passwords for a real customer are recorded after the response", async () => {
    setEnv(ON);
    switchBrowser("attacker");
    for (let i = 0; i < 5; i += 1) {
      const res = await login(loginRequest(customer.email, `WrongPass${i}`));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid email or password." });
    }
    await drainBackgroundTasks();
    expect(await mem.db.collection("SecurityEvent").countDocuments({ type: "LOGIN_FAILED" })).toBe(5);
    expect((await risk())?.reasonCodes).toEqual(["LOGIN_FAILURE_BURST"]);
    expect((await risk())?.tier).toBe("MEDIUM");
    // Unknown emails leave no trace.
    await login(loginRequest("nobody@example.com", "WrongPass1"));
    await drainBackgroundTasks();
    expect(await mem.db.collection("SecurityEvent").countDocuments({ type: "LOGIN_FAILED" })).toBe(5);
  });

  it("the cf-ipcountry header is ignored unless trusted", async () => {
    setEnv(ON);
    await loginOn("laptop", { "cf-ipcountry": "US" });
    let created = await mem.db.collection("SecurityEvent").findOne({ type: "SESSION_CREATED" });
    expect(created?.coarseGeo).toBeUndefined();
    setEnv({ SECURITY_TRUST_PROXY_GEO: "on" });
    await loginOn("phone", { "cf-ipcountry": "in" });
    created = await mem.db.collection("SecurityEvent").findOne({ type: "SESSION_CREATED" }, { sort: { occurredAt: -1 } });
    expect(created?.coarseGeo).toBe("IN");
  });

  it("customers never see risk data in responses", async () => {
    setEnv(ON);
    for (const name of ["a", "b", "a", "b", "a"]) await loginOn(name);
    switchBrowser("b");
    const res = await login(loginRequest(customer.email));
    const text = await res.text();
    expect(text).not.toMatch(/risk|RAPID|PING_PONG|tier|score/i);
  });
});
