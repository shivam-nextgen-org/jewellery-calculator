import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

/**
 * I4 end to end through the real login/logout handlers and guards. Only the
 * cookie jar (next/headers) and the DB connection (in-memory) are swapped.
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
const { requireUser, getPageAccess } = await import("@/lib/auth/session");
const { hashPassword } = await import("@/lib/auth/password");
const { signSession } = await import("@/lib/auth/token");
const { ensureIndexes } = await import("@/lib/security/indexes");

const PASSWORD = "Customer123";
const SESSIONS_ON = {
  SECURITY_ACCESS_DECISION: "enforce",
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "enforce",
};

let ip = 0;
function loginRequest(email: string) {
  ip += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.19.${Math.floor(ip / 250)}.${ip % 250}`,
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

const browsers: Record<string, Map<string, string>> = {};
function switchBrowser(name: string) {
  browsers[name] ??= new Map();
  h.jar = browsers[name];
}

describe("I4 concurrent sessions through the real routes", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let customer: { _id: ObjectId; email: string };

  beforeAll(async () => {
    mem = await startMemoryDb("route_i4_test");
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

  function setEnv(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  }

  async function loginOn(browser: string) {
    switchBrowser(browser);
    const res = await login(loginRequest(customer.email));
    expect(res.status).toBe(200);
  }

  it("flags off: both browsers keep working", async () => {
    await loginOn("laptop");
    await loginOn("phone");
    switchBrowser("laptop");
    await expect(requireUser()).resolves.toBeTruthy();
    switchBrowser("phone");
    await expect(requireUser()).resolves.toBeTruthy();
  });

  it("detect: second device login is recorded, first device keeps working", async () => {
    setEnv({ ...SESSIONS_ON, SECURITY_CONCURRENCY_ENABLED: "detect" });
    await loginOn("laptop");
    await loginOn("phone");
    switchBrowser("laptop");
    await expect(requireUser()).resolves.toBeTruthy();
    expect(await mem.db.collection("SecurityEvent").countDocuments({ type: "CONCURRENT_SESSION_DETECTED" })).toBe(1);
  });

  describe("enforce", () => {
    beforeEach(() => setEnv({ ...SESSIONS_ON, SECURITY_CONCURRENCY_ENABLED: "enforce" }));

    it("NEWEST_WINS: the laptop's session ends when the phone signs in", async () => {
      await loginOn("laptop");
      await loginOn("phone");

      switchBrowser("laptop");
      await expect(requireUser()).rejects.toMatchObject({ status: 401, code: "SESSION_EVICTED" });
      expect(await getPageAccess("USER")).toEqual({
        kind: "denied",
        status: 401,
        device: { state: "SIGNED_IN_ELSEWHERE" },
      });
      switchBrowser("phone");
      await expect(requireUser()).resolves.toMatchObject({ email: customer.email });
    });

    it("signing in again on the laptop takes the session back", async () => {
      await loginOn("laptop");
      await loginOn("phone");
      await loginOn("laptop");
      await expect(requireUser()).resolves.toBeTruthy();
      switchBrowser("phone");
      await expect(requireUser()).rejects.toMatchObject({ code: "SESSION_EVICTED" });
    });

    it("an evicted session can't be revived by replaying its cookies", async () => {
      await loginOn("laptop");
      const captured = new Map(browsers.laptop);
      await loginOn("phone");
      browsers.replay = new Map(captured);
      switchBrowser("replay");
      for (let i = 0; i < 3; i += 1) {
        await expect(requireUser()).rejects.toMatchObject({ status: 401 });
      }
    });

    it("same-browser re-login keeps one working session", async () => {
      await loginOn("laptop");
      await loginOn("laptop");
      await expect(requireUser()).resolves.toBeTruthy();
      expect(await mem.db.collection("SecuritySession").countDocuments({ status: "ACTIVE" })).toBe(1);
    });

    it("simultaneous logins from three browsers leave exactly one working", async () => {
      const names = ["a", "b", "c"];
      // Give each browser its device first so they are distinct devices.
      for (const name of names) await loginOn(name);
      const jars = names.map((name) => browsers[name]);
      await Promise.all(
        jars.map(async (jar) => {
          h.jar = jar;
          return login(loginRequest(customer.email));
        }),
      );
      let working = 0;
      for (const name of names) {
        switchBrowser(name);
        try {
          await requireUser();
          working += 1;
        } catch {
          // evicted
        }
      }
      expect(working).toBeLessThanOrEqual(1);
      expect(await mem.db.collection("SecuritySession").countDocuments({ status: "ACTIVE" })).toBe(1);
    });

    it("logout on the winner leaves no working session; the loser stays evicted", async () => {
      await loginOn("laptop");
      await loginOn("phone");
      await logout();
      switchBrowser("laptop");
      await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    });

    it("pre-cutover JWTs keep their grace behaviour (not session-checked)", async () => {
      vi.stubEnv("SECURITY_SESSIONS_CUTOVER_AT", new Date(Date.now() + 3_600_000).toISOString());
      switchBrowser("old");
      h.jar.set(
        "atelier_session",
        await signSession({ id: customer._id.toHexString(), email: customer.email, name: "Cust", role: "USER" }, 7),
      );
      await loginOn("phone");
      switchBrowser("old");
      await expect(requireUser()).resolves.toBeTruthy();
    });

    it("no session ids or secrets in events", async () => {
      await loginOn("laptop");
      await loginOn("phone");
      const stored = JSON.stringify(await mem.db.collection("SecurityEvent").find().toArray());
      for (const jar of Object.values(browsers)) {
        for (const value of jar.values()) expect(stored).not.toContain(value);
      }
      expect(stored).not.toMatch(/sessionIdHash|secretHash/);
      const types = (await mem.db.collection("SecurityEvent").distinct("type")).sort();
      expect(types).toEqual(expect.arrayContaining(["CONCURRENT_SESSION_DETECTED", "SESSION_CREATED", "SESSION_EVICTED"]));
    });
  });
});
