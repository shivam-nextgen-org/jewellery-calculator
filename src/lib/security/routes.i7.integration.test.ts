import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

/**
 * I7 through the real route handlers. Only the cookie jar (next/headers) and
 * the DB connection (in-memory MongoDB) are swapped.
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
const { GET: listRoute } = await import("@/app/api/admin/security/customers/route");
const { GET: detailRoute } = await import("@/app/api/admin/security/customers/[id]/route");
const { POST: actionRoute } = await import("@/app/api/admin/security/customers/[id]/actions/route");
const { requireUser } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/auth/password");
const { signSession } = await import("@/lib/auth/token");
const { drainBackgroundTasks } = await import("@/lib/security/background");
const { ensureIndexes } = await import("@/lib/security/indexes");

const PASSWORD = "Customer123";
const ADMIN_PASSWORD = "AdminPass123";
const ON = {
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "enforce",
  SECURITY_CONCURRENCY_ENABLED: "enforce",
  SECURITY_ADMIN_SECURITY_CENTER: "on",
};

let ip = 0;
const loginRequest = (email: string) => {
  ip += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.22.${Math.floor(ip / 250)}.${ip % 250}` },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: Record<string, unknown>) =>
  actionRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), params(id));

const browsers: Record<string, Map<string, string>> = {};
function switchBrowser(name: string) {
  browsers[name] ??= new Map();
  h.jar = browsers[name];
}

describe("I7 Admin Security Center routes", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let customer: { _id: ObjectId; email: string };
  let admin: { _id: ObjectId; email: string };

  beforeAll(async () => {
    mem = await startMemoryDb("route_i7_test");
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
    h.headers = new Headers();
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
    for (const [k, v] of Object.entries(values)) vi.stubEnv(k, v);
  };
  async function asAdmin() {
    switchBrowser("admin");
    h.jar.set("atelier_session", await signSession({ id: admin._id.toHexString(), email: admin.email, name: "Admin", role: "SUPER_ADMIN" }, 1));
  }

  it("flag off: every center route is 404 and login is unchanged", async () => {
    await asAdmin();
    expect((await listRoute()).status).toBe(404);
    expect((await detailRoute(new Request("http://x"), params(customer._id.toHexString()))).status).toBe(404);
    expect((await post(customer._id.toHexString(), { action: "FORCE_LOGOUT" })).status).toBe(404);
    switchBrowser("laptop");
    expect(await (await login(loginRequest(customer.email))).json()).toEqual({ role: "USER", name: "Cust", redirect: "/dashboard" });
  });

  describe("flag on", () => {
    beforeEach(() => setEnv(ON));

    it("anonymous → 401, customer → 403, API key → 401", async () => {
      switchBrowser("nobody");
      expect((await listRoute()).status).toBe(401);
      switchBrowser("laptop");
      await login(loginRequest(customer.email));
      expect((await listRoute()).status).toBe(403);
      expect((await post(customer._id.toHexString(), { action: "FORCE_LOGOUT", password: PASSWORD, reason: "x" })).status).toBe(403);
      switchBrowser("script");
      h.headers = new Headers({ "x-api-key": "atl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
      expect((await listRoute()).status).toBe(401);
    });

    it("a disabled admin is refused even with access-decision enforcement off", async () => {
      setEnv({ SECURITY_ACCESS_DECISION: "off" });
      await asAdmin();
      await mem.db.collection("User").updateOne({ _id: admin._id }, { $set: { isActive: false } });
      expect((await listRoute()).status).toBe(403);
      expect((await detailRoute(new Request("http://x"), params(customer._id.toHexString()))).status).toBe(403);
    });

    it("invalid and unknown customer ids are 404", async () => {
      await asAdmin();
      for (const id of ["nope", new ObjectId().toHexString(), admin._id.toHexString()]) {
        expect((await detailRoute(new Request("http://x"), params(id))).status).toBe(404);
      }
    });

    it("end to end: admin force-logs-out the customer, who can't continue", async () => {
      switchBrowser("laptop");
      await login(loginRequest(customer.email));
      await drainBackgroundTasks();
      await expect(requireUser()).resolves.toBeTruthy();

      await asAdmin();
      const list = await (await listRoute()).json();
      expect(list.customers[0]).toMatchObject({ email: customer.email, trustedDevices: 1 });
      const detail = await (await detailRoute(new Request("http://x"), params(customer._id.toHexString()))).json();
      expect(detail.sessions).toHaveLength(1);

      expect((await post(customer._id.toHexString(), { action: "FORCE_LOGOUT", reason: "Lost laptop" })).status).toBe(400);
      const res = await post(customer._id.toHexString(), { action: "FORCE_LOGOUT", password: ADMIN_PASSWORD, reason: "Lost laptop" });
      expect(await res.json()).toEqual({ outcome: "LOGGED_OUT", applied: true });

      switchBrowser("laptop");
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });
      // Logging in again works (force logout isn't a ban).
      await new Promise((r) => setTimeout(r, 5));
      await login(loginRequest(customer.email));
      await expect(requireUser()).resolves.toBeTruthy();
    });

    it("responses contain no cookies, secrets or hashes", async () => {
      switchBrowser("laptop");
      await login(loginRequest(customer.email));
      const cookies = [...browsers.laptop.values()];
      await asAdmin();
      const text = await (await detailRoute(new Request("http://x"), params(customer._id.toHexString()))).text();
      for (const value of cookies) expect(text).not.toContain(value);
      expect(text).not.toMatch(/passwordHash|secretHash|sessionIdHash|"ipHash"|\$2b\$|198\.22\./);
    });
  });
});
