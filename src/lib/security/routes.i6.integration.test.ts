import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

/**
 * I6 end to end: login route → risk evaluation after the response →
 * restriction → authorize()/page guard → admin lift route. Only the cookie
 * jar and DB connection are swapped.
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
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { GET: listRoute } = await import("@/app/api/admin/security/restrictions/route");
const { POST: liftRoute } = await import("@/app/api/admin/security/restrictions/[id]/lift/route");
const { requireUser, getPageAccess } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/auth/password");
const { signSession } = await import("@/lib/auth/token");
const { drainBackgroundTasks } = await import("@/lib/security/background");
const { recordSecurityEvent } = await import("@/lib/security/events");
const { ensureIndexes } = await import("@/lib/security/indexes");

const PASSWORD = "Customer123";
const ADMIN_PASSWORD = "AdminPass123";
const BASE = {
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "enforce",
  SECURITY_CONCURRENCY_ENABLED: "enforce",
  SECURITY_DEVICE_LIMIT: "10",
};
const ACT = { ...BASE, SECURITY_RISK_ENGINE_ENABLED: "act", SECURITY_RESTRICTIONS_ENABLED: "on" };

let ip = 0;
function loginRequest(email: string, password = PASSWORD) {
  ip += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.21.${Math.floor(ip / 250)}.${ip % 250}` },
    body: JSON.stringify({ email, password }),
  });
}
const browsers: Record<string, Map<string, string>> = {};
function switchBrowser(name: string) {
  browsers[name] ??= new Map();
  h.jar = browsers[name];
}

describe("I6 restrictions through the real routes", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let customer: { _id: ObjectId; email: string };
  let admin: { _id: ObjectId; email: string };

  beforeAll(async () => {
    mem = await startMemoryDb("route_i6_test");
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
    admin = { _id: new ObjectId(), email: "admin@example.com" };
    const now = new Date();
    await mem.db.collection("User").insertMany([
      { ...customer, name: "Cust", role: "USER", isActive: true, passwordHash: await hashPassword(PASSWORD), createdAt: now, updatedAt: now },
      { ...admin, name: "Admin", role: "SUPER_ADMIN", isActive: true, passwordHash: await hashPassword(ADMIN_PASSWORD), createdAt: now, updatedAt: now },
    ]);
  });
  afterEach(() => vi.unstubAllEnvs());

  const setEnv = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  };
  /** HIGH-risk evidence: a device mismatch + 5 wrong passwords, just now. */
  async function seedHighRisk() {
    const t = Date.now();
    await recordSecurityEvent(mem.db, { type: "SESSION_DEVICE_MISMATCH", actorType: "SYSTEM", userId: customer._id, occurredAt: new Date(t - 60_000) });
    for (let i = 0; i < 5; i += 1) {
      await recordSecurityEvent(mem.db, { type: "LOGIN_FAILED", actorType: "USER", userId: customer._id, occurredAt: new Date(t - (i + 2) * 60_000) });
    }
  }
  async function loginOn(browser: string) {
    switchBrowser(browser);
    const res = await login(loginRequest(customer.email));
    await drainBackgroundTasks();
    return res;
  }
  async function signInAdmin() {
    switchBrowser("admin");
    h.jar.set("atelier_session", await signSession({ id: admin._id.toHexString(), email: admin.email, name: "Admin", role: "SUPER_ADMIN" }, 1));
  }
  const restrictionCount = () => mem.db.collection("SecurityRestriction").countDocuments();

  it("flags off: no restriction, same login response, customer not blocked", async () => {
    await seedHighRisk();
    const res = await loginOn("laptop");
    expect(await res.json()).toEqual({ role: "USER", name: "Cust", redirect: "/dashboard" });
    await expect(requireUser()).resolves.toBeTruthy();
    expect(await restrictionCount()).toBe(0);
    await signInAdmin();
    expect((await listRoute()).status).toBe(404);
  });

  it("log-only: risk recorded, nothing restricted", async () => {
    setEnv({ ...ACT, SECURITY_RISK_ENGINE_ENABLED: "log-only" });
    await seedHighRisk();
    await loginOn("laptop");
    expect(await restrictionCount()).toBe(0);
    await expect(requireUser()).resolves.toBeTruthy();
  });

  describe("act", () => {
    beforeEach(() => setEnv(ACT));

    it("HIGH risk restricts; customer sees the notice with no redirect loop", async () => {
      await seedHighRisk();
      expect((await loginOn("laptop")).status).toBe(200);
      await expect(requireUser()).rejects.toMatchObject({ status: 403, code: "ACCOUNT_TEMPORARILY_RESTRICTED" });
      const access = await getPageAccess("USER");
      expect(access).toMatchObject({ kind: "denied", status: 403, device: { state: "RESTRICTED", pendingReview: false } });
      if (access.kind === "denied" && access.device?.state === "RESTRICTED") {
        expect(new Date(access.device.until!).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
      }
      // Logging in again works (no loop) and exposes nothing about risk.
      const again = await loginOn("laptop");
      expect(again.status).toBe(200);
      expect(await again.text()).not.toMatch(/risk|restrict|score|tier|REASON|MISMATCH/i);
      // Logout still works while restricted.
      expect((await logout()).status).toBe(200);
      expect(h.jar.has("atelier_sid")).toBe(false);
    });

    it("customers can't lift their own restriction", async () => {
      await seedHighRisk();
      await loginOn("laptop");
      const [doc] = await mem.db.collection("SecurityRestriction").find().toArray();
      const res = await liftRoute(
        new Request("http://localhost", { method: "POST", body: JSON.stringify({ userId: customer._id.toHexString(), password: PASSWORD, reason: "me" }) }),
        { params: Promise.resolve({ id: doc._id.toHexString() }) },
      );
      expect(res.status).toBe(403);
      expect((await listRoute()).status).toBe(403);
    });

    it("admin lifts with step-up; access returns; device and session rules still apply", async () => {
      await seedHighRisk();
      await loginOn("laptop");
      await signInAdmin();
      const list = await (await listRoute()).json();
      expect(list.accounts).toHaveLength(1);
      const id = list.accounts[0].restriction.id;
      const post = (body: Record<string, unknown>) =>
        liftRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
      expect((await post({ userId: customer._id.toHexString(), reason: "ok" })).status).toBe(400);
      expect((await post({ userId: customer._id.toHexString(), password: "nope-nope-1", reason: "ok" })).status).toBe(401);
      const ok = await post({ userId: customer._id.toHexString(), password: ADMIN_PASSWORD, reason: "Verified by phone" });
      expect(await ok.json()).toEqual({ outcome: "REMOVED", applied: true });
      expect(await (await post({ userId: customer._id.toHexString(), password: ADMIN_PASSWORD, reason: "again" })).json()).toEqual({ outcome: "ALREADY_ENDED", applied: false });

      switchBrowser("laptop");
      await expect(requireUser()).resolves.toMatchObject({ email: customer.email });
      // NEWEST_WINS still applies after the lift.
      await loginOn("phone");
      switchBrowser("laptop");
      await expect(requireUser()).rejects.toMatchObject({ code: "SESSION_EVICTED" });
    });

    it("a disabled customer stays disabled after a lift", async () => {
      await seedHighRisk();
      await loginOn("laptop");
      await mem.db.collection("User").updateOne({ _id: customer._id }, { $set: { isActive: false } });
      await mem.db.collection("SecurityAccount").updateOne({ _id: customer._id }, { $set: { restriction: null } });
      await expect(requireUser()).rejects.toMatchObject({ status: 403, code: "ACCOUNT_SUSPENDED" });
    });

    it("an expired restriction stops blocking immediately", async () => {
      await seedHighRisk();
      await loginOn("laptop");
      await mem.db.collection("SecurityAccount").updateOne(
        { _id: customer._id },
        { $set: { "restriction.expiresAt": new Date(Date.now() - 1000) } },
      );
      await expect(requireUser()).resolves.toBeTruthy();
      await drainBackgroundTasks();
      const [doc] = await mem.db.collection("SecurityRestriction").find().toArray();
      expect(doc.status).toBe("EXPIRED");
    });

    it("concurrent logins while being restricted end with exactly one restriction", async () => {
      await seedHighRisk();
      switchBrowser("laptop");
      await Promise.all([login(loginRequest(customer.email)), login(loginRequest(customer.email)), login(loginRequest(customer.email))]);
      await drainBackgroundTasks();
      expect(await mem.db.collection("SecurityRestriction").countDocuments({ status: "ACTIVE" })).toBe(1);
    });
  });
});
