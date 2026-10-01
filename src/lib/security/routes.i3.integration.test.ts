import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

/**
 * I3 end to end through the real route handlers. Only the request cookie jar
 * (next/headers) and the DB connection (in-memory MongoDB) are swapped.
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
const { GET: pendingRoute } = await import("@/app/api/admin/security/devices/pending/route");
const { POST: approveRoute } = await import("@/app/api/admin/security/devices/[id]/approve/route");
const { POST: rejectRoute } = await import("@/app/api/admin/security/devices/[id]/reject/route");
const { GET: listDevicesRoute } = await import("@/app/api/devices/route");
const { requireUser, getPageAccess } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/auth/password");
const { signSession } = await import("@/lib/auth/token");
const { ensureIndexes } = await import("@/lib/security/indexes");

const CUSTOMER_PASSWORD = "Customer123";
const ADMIN_PASSWORD = "AdminPass123";

/** Full enforcement: every I3 prerequisite present. */
const ENFORCE = {
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "enforce",
  SECURITY_DEVICE_VERIFICATION_ENABLED: "on",
  SECURITY_SESSIONS_ENABLED: "enforce",
  COOKIE_SECURE: "true",
};

let ipCounter = 0;
function loginRequest(email: string, password = CUSTOMER_PASSWORD) {
  ipCounter += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Mac OS X 14_0) Safari/605.1.15",
      "x-forwarded-for": `198.18.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: JSON.stringify({ email, password }),
  });
}

function decisionRequest(body: Record<string, unknown>) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Each "browser" is its own cookie jar. */
type Browser = Map<string, string>;
const browsers: Record<string, Browser> = {};
function switchBrowser(name: string) {
  browsers[name] ??= new Map();
  h.jar = browsers[name];
}

describe("I3 device verification routes (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let customer: { _id: ObjectId; email: string };
  let admin: { _id: ObjectId; email: string };

  beforeAll(async () => {
    mem = await startMemoryDb("route_i3_test");
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
      { ...customer, name: "Cust", role: "USER", isActive: true, passwordHash: await hashPassword(CUSTOMER_PASSWORD), createdAt: now, updatedAt: now },
      { ...admin, name: "Admin", role: "SUPER_ADMIN", isActive: true, passwordHash: await hashPassword(ADMIN_PASSWORD), createdAt: now, updatedAt: now },
    ]);
  });
  afterEach(() => vi.unstubAllEnvs());

  function setEnv(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  }

  async function signInAdmin() {
    switchBrowser("admin");
    h.jar.set(
      "atelier_session",
      await signSession({ id: admin._id.toHexString(), email: admin.email, name: "Admin", role: "SUPER_ADMIN" }, 1),
    );
  }

  /** Laptop gets the one-time auto-trust; phone becomes a pending request. */
  async function laptopThenPhone() {
    switchBrowser("laptop");
    expect((await login(loginRequest(customer.email))).status).toBe(200);
    switchBrowser("phone");
    const res = await login(loginRequest(customer.email));
    expect(res.status).toBe(200);
    return (await res.json()) as { device?: { status: string; referenceCode: string; expiresAt: string } };
  }

  async function pendingDeviceId() {
    const d = await mem.db.collection("SecurityDevice").findOne({ userId: customer._id, status: "PENDING_VERIFICATION" });
    return d!._id.toHexString();
  }

  describe("feature flags off", () => {
    it("admin verification APIs don't exist and login is unchanged", async () => {
      await signInAdmin();
      expect((await pendingRoute()).status).toBe(404);
      expect((await approveRoute(decisionRequest({}), params(new ObjectId().toHexString()))).status).toBe(404);
      switchBrowser("laptop");
      const res = await login(loginRequest(customer.email));
      expect(await res.json()).toEqual({ role: "USER", name: "Cust", redirect: "/dashboard" });
      expect([...h.jar.keys()]).toEqual(["atelier_session"]);
    });

    it("device-trust enforce without verification enabled stays in detect", async () => {
      setEnv({ ...ENFORCE, SECURITY_DEVICE_VERIFICATION_ENABLED: "" });
      await laptopThenPhone();
      await expect(requireUser()).resolves.toBeTruthy(); // phone is pending but not blocked
    });
  });

  describe("admin authorization", () => {
    beforeEach(() => setEnv(ENFORCE));

    it("anonymous → 401, customer → 403, API key can't act as admin", async () => {
      switchBrowser("nobody");
      expect((await pendingRoute()).status).toBe(401);
      switchBrowser("laptop");
      await login(loginRequest(customer.email));
      expect((await pendingRoute()).status).toBe(403);
      const id = (await mem.db.collection("SecurityDevice").findOne({}))!._id.toHexString();
      expect(
        (await approveRoute(decisionRequest({ userId: customer._id.toHexString(), password: CUSTOMER_PASSWORD }), params(id))).status,
      ).toBe(403);
      switchBrowser("script");
      h.headers = new Headers({ "x-api-key": "atl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
      expect((await pendingRoute()).status).toBe(401);
    });
  });

  describe("full approval path with enforcement on", () => {
    beforeEach(() => setEnv(ENFORCE));

    it("pending phone waits, admin approves with step-up, phone works without re-login", async () => {
      const loginBody = await laptopThenPhone();
      expect(loginBody.device).toMatchObject({ status: "PENDING_APPROVAL", referenceCode: expect.stringMatching(/^[0-9A-F]{4}-[0-9A-F]{4}$/) });

      // Customer on the phone: blocked, with the waiting-for-approval state.
      switchBrowser("phone");
      await expect(requireUser()).rejects.toMatchObject({ status: 401, code: "DEVICE_NOT_TRUSTED" });
      const access = await getPageAccess("USER");
      expect(access).toMatchObject({
        kind: "denied",
        device: { state: "PENDING", referenceCode: loginBody.device!.referenceCode, title: "Waiting for approval" },
      });
      // Laptop is unaffected.
      switchBrowser("laptop");
      await expect(requireUser()).resolves.toBeTruthy();

      // Admin sees the same reference code in the queue.
      await signInAdmin();
      const queue = await (await pendingRoute()).json();
      expect(queue.devices).toHaveLength(1);
      expect(queue.devices[0]).toMatchObject({ customerEmail: customer.email, referenceCode: loginBody.device!.referenceCode });
      const id = queue.devices[0].id;

      // Step-up is mandatory.
      expect((await approveRoute(decisionRequest({ userId: customer._id.toHexString() }), params(id))).status).toBe(400);
      expect((await approveRoute(decisionRequest({ userId: customer._id.toHexString(), password: "nope-nope-1" }), params(id))).status).toBe(401);
      const ok = await approveRoute(decisionRequest({ userId: customer._id.toHexString(), password: ADMIN_PASSWORD }), params(id));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ outcome: "TRUSTED", applied: true });
      const again = await approveRoute(decisionRequest({ userId: customer._id.toHexString(), password: ADMIN_PASSWORD }), params(id));
      expect(await again.json()).toEqual({ outcome: "ALREADY_TRUSTED", applied: false });

      switchBrowser("phone");
      await expect(requireUser()).resolves.toMatchObject({ email: customer.email });
      expect(await getPageAccess("USER")).toMatchObject({ kind: "ok" });
    });

    it("rejection: phone is told, its session ends, replaying the cookie makes a new request", async () => {
      await laptopThenPhone();
      const id = await pendingDeviceId();
      await signInAdmin();
      const res = await rejectRoute(
        decisionRequest({ userId: customer._id.toHexString(), password: ADMIN_PASSWORD, reason: "Not the customer" }),
        params(id),
      );
      expect(await res.json()).toEqual({ outcome: "REJECTED", applied: true });

      switchBrowser("phone");
      expect(await getPageAccess("USER")).toMatchObject({ kind: "denied", device: { state: "REJECTED" } });
      await login(loginRequest(customer.email));
      const statuses = (await mem.db.collection("SecurityDevice").find({ userId: customer._id }).toArray()).map((d) => d.status).sort();
      expect(statuses).toEqual(["PENDING_VERIFICATION", "REVOKED", "TRUSTED"]);
      await expect(requireUser()).rejects.toMatchObject({ code: "DEVICE_NOT_TRUSTED" });
    });

    it("approval can't target another customer's device", async () => {
      await laptopThenPhone();
      const id = await pendingDeviceId();
      await signInAdmin();
      for (const userId of [new ObjectId().toHexString(), admin._id.toHexString(), "x"]) {
        const res = await approveRoute(decisionRequest({ userId, password: ADMIN_PASSWORD }), params(id));
        expect(res.status).toBe(404);
      }
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: new ObjectId(id) }))?.status).toBe("PENDING_VERIFICATION");
    });

    it("the customer's own device list shows the waiting request", async () => {
      await laptopThenPhone();
      switchBrowser("laptop");
      const body = await (await listDevicesRoute()).json();
      const pending = body.devices.find((d: { status: string }) => d.status === "PENDING_VERIFICATION");
      expect(pending).toMatchObject({ referenceCode: expect.any(String), pendingExpiresAt: expect.any(String), current: false });
    });

    it("pre-cutover customers keep working with no device cookie (backward compatible)", async () => {
      vi.stubEnv("SECURITY_SESSIONS_CUTOVER_AT", new Date(Date.now() + 3_600_000).toISOString());
      switchBrowser("old-browser");
      h.jar.set(
        "atelier_session",
        await signSession({ id: customer._id.toHexString(), email: customer.email, name: "Cust", role: "USER" }, 7),
      );
      await expect(requireUser()).resolves.toMatchObject({ email: customer.email });
    });

    it("no secrets in API responses or stored records", async () => {
      await laptopThenPhone();
      const phoneCookies = [...browsers.phone.values()];
      await signInAdmin();
      const queueText = await (await pendingRoute()).text();
      const id = JSON.parse(queueText).devices[0].id;
      const decisionText = await (
        await approveRoute(decisionRequest({ userId: customer._id.toHexString(), password: ADMIN_PASSWORD }), params(id))
      ).text();
      const stored = JSON.stringify([
        await mem.db.collection("SecurityEvent").find().toArray(),
        await mem.db.collection("SecurityAdminAction").find().toArray(),
      ]);
      for (const text of [queueText, decisionText, stored]) {
        for (const secret of [...phoneCookies, ADMIN_PASSWORD, CUSTOMER_PASSWORD]) expect(text).not.toContain(secret);
        expect(text).not.toMatch(/secretHash|passwordHash|sessionIdHash/);
      }
    });
  });
});
