import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { decodeJwt } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

/**
 * Exercises the real route handlers and guards. Only two things are swapped:
 * the request cookie jar (next/headers) and the DB connection (in-memory
 * MongoDB). Nothing here can reach a real database.
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
const { GET: listDevicesRoute } = await import("@/app/api/devices/route");
const { PATCH: renameRoute, DELETE: revokeRoute } = await import("@/app/api/devices/[id]/route");
const { requireUser, getPageAccess, AuthError } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/auth/password");
const { signSession } = await import("@/lib/auth/token");
const { ensureIndexes } = await import("@/lib/security/indexes");

const PASSWORD = "Customer123";
const FLAGS_ON = {
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "enforce",
};

function setEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

let ipCounter = 0;
function loginRequest(email: string, password = PASSWORD) {
  ipCounter += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36",
      // The existing login limiter is per IP; give each test login its own.
      "x-forwarded-for": `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    },
    body: JSON.stringify({ email, password }),
  });
}

/** Cookies for a different browser: keep only the listed ones. */
function newBrowser(keep: string[] = []) {
  for (const name of [...h.jar.keys()]) if (!keep.includes(name)) h.jar.delete(name);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("I2 routes and guards (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let alice: { _id: ObjectId; email: string };
  let bob: { _id: ObjectId; email: string };

  beforeAll(async () => {
    mem = await startMemoryDb("route_test");
    h.db = mem.db;
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());

  beforeEach(async () => {
    vi.stubEnv("SESSION_SECRET", "integration-test-secret-0123456789");
    vi.stubEnv("NODE_ENV", "test");
    // Cutover in the past: every login made during a test is post-cutover.
    vi.stubEnv("SECURITY_SESSIONS_CUTOVER_AT", "2026-01-01T00:00:00Z");
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    h.jar.clear();
    h.headers = new Headers();
    const now = new Date();
    const passwordHash = await hashPassword(PASSWORD);
    alice = { _id: new ObjectId(), email: "alice@example.com" };
    bob = { _id: new ObjectId(), email: "bob@example.com" };
    await mem.db.collection("User").insertMany(
      [alice, bob].map((u) => ({
        ...u,
        name: u.email.split("@")[0],
        passwordHash,
        role: "USER",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("backward compatibility (flags off)", () => {
    it("login behaves exactly as before: JWT only, no security records", async () => {
      const res = await login(loginRequest(alice.email));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role: "USER", name: "alice", redirect: "/dashboard" });
      expect([...h.jar.keys()]).toEqual(["atelier_session"]);
      for (const name of ["SecurityAccount", "SecurityDevice", "SecuritySession", "SecurityEvent"]) {
        expect(await mem.db.collection(name).countDocuments()).toBe(0);
      }
      await expect(requireUser()).resolves.toMatchObject({ email: alice.email });
    });

    it("device APIs are hidden while device tracking is off", async () => {
      await login(loginRequest(alice.email));
      expect((await listDevicesRoute()).status).toBe(404);
    });

    it("wrong passwords and disabled accounts are unchanged", async () => {
      setEnv(FLAGS_ON);
      expect((await login(loginRequest(alice.email, "Wrong1234"))).status).toBe(401);
      await mem.db.collection("User").updateOne({ _id: bob._id }, { $set: { isActive: false } });
      expect((await login(loginRequest(bob.email))).status).toBe(403);
      expect(await mem.db.collection("SecurityDevice").countDocuments()).toBe(0);
    });
  });

  describe("login with device tracking + sessions on", () => {
    beforeEach(() => setEnv(FLAGS_ON));

    it("grandfathers the existing customer's first device and binds a session", async () => {
      const res = await login(loginRequest(alice.email));
      expect(res.status).toBe(200);
      expect([...h.jar.keys()].sort()).toEqual(["atelier_device", "atelier_session", "atelier_sid"]);

      const device = await mem.db.collection("SecurityDevice").findOne({ userId: alice._id });
      expect(device?.status).toBe("TRUSTED");
      const session = await mem.db.collection("SecuritySession").findOne({ userId: alice._id });
      expect(session?.deviceId).toEqual(device?._id);
      await expect(requireUser()).resolves.toMatchObject({ id: alice._id.toHexString() });
    });

    it("keeps the JWT format unchanged", async () => {
      await login(loginRequest(alice.email));
      const claims = decodeJwt(h.jar.get("atelier_session")!);
      expect(Object.keys(claims).sort()).toEqual(["email", "exp", "iat", "id", "name", "role"]);
    });

    it("subsequent login on the same browser reuses the device", async () => {
      await login(loginRequest(alice.email));
      const cookie = h.jar.get("atelier_device");
      await login(loginRequest(alice.email));
      expect(h.jar.get("atelier_device")).toBe(cookie);
      expect(await mem.db.collection("SecurityDevice").countDocuments({ userId: alice._id })).toBe(1);
    });

    it("a second browser gets a pending device, not an automatic trust", async () => {
      await login(loginRequest(alice.email));
      newBrowser();
      await login(loginRequest(alice.email));
      const statuses = (await mem.db.collection("SecurityDevice").find({ userId: alice._id }).toArray())
        .map((d) => d.status)
        .sort();
      expect(statuses).toEqual(["PENDING_VERIFICATION", "TRUSTED"]);
      // Device trust is only detected in I2, so the pending browser still works.
      await expect(requireUser()).resolves.toBeTruthy();
    });

    it("refuses a login past the device limit when sessions are enforced", async () => {
      for (let i = 0; i < 3; i += 1) {
        newBrowser();
        expect((await login(loginRequest(alice.email))).status).toBe(200);
      }
      newBrowser();
      const res = await login(loginRequest(alice.email));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/device limit/);
      expect(h.jar.has("atelier_session")).toBe(false);
    });

    it("existing JWTs issued before the cutover keep working (no mass invalidation)", async () => {
      vi.stubEnv("SECURITY_SESSIONS_CUTOVER_AT", new Date(Date.now() + 3_600_000).toISOString());
      const legacy = await signSession(
        { id: alice._id.toHexString(), email: alice.email, name: "alice", role: "USER" },
        7,
      );
      h.jar.set("atelier_session", legacy); // pre-I2 browser: no device, no sid
      await expect(requireUser()).resolves.toMatchObject({ email: alice.email });
    });

    it("a post-cutover JWT without its session cookie is rejected (stripped sid)", async () => {
      await login(loginRequest(alice.email));
      h.jar.delete("atelier_sid");
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    });

    it("a session cookie from another user is rejected", async () => {
      await login(loginRequest(bob.email));
      const bobSid = h.jar.get("atelier_sid")!;
      newBrowser();
      await login(loginRequest(alice.email));
      h.jar.set("atelier_sid", bobSid);
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    });

    it("logout revokes the server session", async () => {
      await login(loginRequest(alice.email));
      const sid = h.jar.get("atelier_sid")!;
      const jwt = h.jar.get("atelier_session")!;
      await logout();
      expect(h.jar.has("atelier_sid")).toBe(false);
      expect(h.jar.has("atelier_device")).toBe(true);
      // Replaying the captured cookies no longer works.
      h.jar.set("atelier_session", jwt);
      h.jar.set("atelier_sid", sid);
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    });
  });

  describe("self-service device APIs", () => {
    beforeEach(() => setEnv(FLAGS_ON));

    async function signInAs(user: { email: string }) {
      newBrowser();
      await login(loginRequest(user.email));
    }

    it("lists only the caller's devices, without sensitive fields", async () => {
      await signInAs(bob);
      await signInAs(alice);
      const res = await listDevicesRoute();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.devices).toHaveLength(1);
      expect(body.devices[0]).toMatchObject({ current: true, status: "TRUSTED" });
      const raw = JSON.stringify(body);
      expect(raw).not.toMatch(/secretHash|userId|purgeAt/);
      expect(raw).not.toContain(h.jar.get("atelier_device")!);
      expect(raw).not.toContain(h.jar.get("atelier_sid")!);
    });

    it("renames own device; another user's device looks like it doesn't exist", async () => {
      await signInAs(bob);
      const bobDevice = await mem.db.collection("SecurityDevice").findOne({ userId: bob._id });
      await signInAs(alice);
      const aliceDevice = await mem.db.collection("SecurityDevice").findOne({ userId: alice._id });

      const patch = (id: string, body: unknown) =>
        renameRoute(
          new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) }),
          params(id),
        );
      const ok = await patch(aliceDevice!._id.toHexString(), { label: "Laptop" });
      expect(ok.status).toBe(200);
      expect((await ok.json()).device.label).toBe("Laptop");

      const idor = await patch(bobDevice!._id.toHexString(), { label: "stolen" });
      expect(idor.status).toBe(404);
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: bobDevice!._id }))?.label).toBeNull();

      expect((await patch("not-an-id", { label: "x" })).status).toBe(404);
      expect((await patch(aliceDevice!._id.toHexString(), { label: "x".repeat(41) })).status).toBe(400);
      expect((await patch(aliceDevice!._id.toHexString(), {})).status).toBe(400);
    });

    it("revokes own device only; the revoked device can't continue its session", async () => {
      await signInAs(bob);
      const bobDevice = await mem.db.collection("SecurityDevice").findOne({ userId: bob._id });
      await signInAs(alice);
      const aliceDevice = await mem.db.collection("SecurityDevice").findOne({ userId: alice._id });
      const del = (id: string) => revokeRoute(new Request("http://localhost", { method: "DELETE" }), params(id));

      expect((await del(bobDevice!._id.toHexString())).status).toBe(404);
      expect((await mem.db.collection("SecurityDevice").findOne({ _id: bobDevice!._id }))?.status).toBe("TRUSTED");

      const sid = h.jar.get("atelier_sid")!;
      expect((await del(aliceDevice!._id.toHexString())).status).toBe(200);
      h.jar.set("atelier_sid", sid); // replay the old session cookie
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });

      // Logging in again on that browser does not revive the revoked device.
      await login(loginRequest(alice.email));
      const devices = await mem.db.collection("SecurityDevice").find({ userId: alice._id }).toArray();
      expect(devices.map((d) => d.status).sort()).toEqual(["PENDING_VERIFICATION", "REVOKED"]);
    });

    it("rejects anonymous callers, API keys and admins", async () => {
      expect((await listDevicesRoute()).status).toBe(401);
      h.headers = new Headers({ "x-api-key": "atl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
      expect((await listDevicesRoute()).status).toBe(401);
      h.jar.set(
        "atelier_session",
        await signSession({ id: new ObjectId().toHexString(), email: "a@x.io", name: "A", role: "SUPER_ADMIN" }, 1),
      );
      expect((await listDevicesRoute()).status).toBe(403);
    });

    it("error responses never echo secrets", async () => {
      await signInAs(alice);
      const res = await renameRoute(
        new Request("http://localhost", { method: "PATCH", body: "{not json" }),
        params(new ObjectId().toHexString()),
      );
      const text = await res.text();
      for (const name of ["atelier_device", "atelier_sid", "atelier_session"]) {
        expect(text).not.toContain(h.jar.get(name)!);
      }
    });
  });

  describe("protected server-component guard (G1)", () => {
    it("allows the customer when flags are off, and anonymous stays anonymous", async () => {
      expect(await getPageAccess("USER")).toEqual({ kind: "anonymous" });
      await login(loginRequest(alice.email));
      expect(await getPageAccess("USER")).toMatchObject({ kind: "ok" });
      expect(await getPageAccess("ADMIN")).toEqual({ kind: "denied", status: 403 });
    });

    it("denies a customer whose session was revoked (sessions enforced)", async () => {
      setEnv(FLAGS_ON);
      await login(loginRequest(alice.email));
      expect(await getPageAccess("USER")).toMatchObject({ kind: "ok" });
      await logout();
      h.jar.set("atelier_session", await signSession(
        { id: alice._id.toHexString(), email: alice.email, name: "alice", role: "USER" },
        7,
      ));
      expect(await getPageAccess("USER")).toEqual({ kind: "denied", status: 401 });
    });

    it("denies a disabled customer with a still-valid JWT once enforced", async () => {
      setEnv({ SECURITY_ACCESS_DECISION: "enforce" });
      await login(loginRequest(alice.email));
      await mem.db.collection("User").updateOne({ _id: alice._id }, { $set: { isActive: false } });
      expect(await getPageAccess("USER")).toEqual({ kind: "denied", status: 403 });
      await expect(requireUser()).rejects.toBeInstanceOf(AuthError);
    });
  });
});
