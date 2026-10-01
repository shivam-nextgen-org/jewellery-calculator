import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSecurityConfig } from "@/lib/security/config";
import { ensureIndexes } from "@/lib/security/indexes";
import {
  applyLoginSecurity,
  loginSecurityGate,
  setLoginSecurityCookies,
} from "@/lib/security/login";
import { lookupSession } from "@/lib/security/session";
import { MEMORY_DB_TIMEOUT, startMemoryDb } from "./__tests__/memory-db";

const cfg = (values: Record<string, string> = {}) =>
  getSecurityConfig({ NODE_ENV: "test", ...values } as NodeJS.ProcessEnv);
const ON = cfg({
  SECURITY_DEVICE_TRUST_ENABLED: "detect",
  SECURITY_SESSIONS_ENABLED: "shadow",
});

function fakeJar() {
  const set = new Map<string, { value: string; options: Record<string, unknown> }>();
  const deleted: string[] = [];
  return {
    set: (name: string, value: string, options: Record<string, unknown>) => set.set(name, { value, options }),
    delete: (name: string) => deleted.push(name),
    cookies: set,
    deleted,
  };
}

describe("login security step (in-memory MongoDB)", () => {
  let mem: Awaited<ReturnType<typeof startMemoryDb>>;
  let userId: string;

  beforeAll(async () => {
    mem = await startMemoryDb();
  }, MEMORY_DB_TIMEOUT);
  afterAll(async () => mem?.stop());
  beforeEach(async () => {
    await mem.reset();
    await ensureIndexes(mem.db, "apply");
    userId = new ObjectId().toHexString();
  });

  const login = (deviceCookie?: string | null, config = ON, role: "USER" | "SUPER_ADMIN" = "USER") =>
    applyLoginSecurity(mem.db, { userId, role, rememberMe: false, deviceCookie }, config);

  it("is a no-op with the flags off (default): no records, no cookies", async () => {
    const result = await login(null, cfg());
    expect(result).toEqual({ kind: "skipped" });
    for (const name of ["SecurityAccount", "SecurityDevice", "SecuritySession", "SecurityEvent"]) {
      expect(await mem.db.collection(name).countDocuments()).toBe(0);
    }
    const jar = fakeJar();
    setLoginSecurityCookies(jar, result, false, cfg());
    expect(jar.cookies.size).toBe(0);
    expect(jar.deleted).toEqual([]);
  });

  it("skips admins in I2", async () => {
    expect(await login(null, ON, "SUPER_ADMIN")).toEqual({ kind: "skipped" });
  });

  it("existing customer: first login trusts the device and binds a session", async () => {
    const result = await login(null);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.deviceSecret).toBeTruthy();
    const state = await lookupSession(mem.db, result.sessionId);
    expect(state.state).toBe("VALID");
    const device = await mem.db.collection("SecurityDevice").findOne({});
    expect(device?.status).toBe("TRUSTED");
    if (state.state === "VALID") expect(state.session.deviceId).toEqual(device?._id);

    const jar = fakeJar();
    setLoginSecurityCookies(jar, result, false, ON);
    expect(jar.cookies.get("atelier_device")?.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
    expect(jar.cookies.get("atelier_sid")?.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });

  it("subsequent login on the same browser reuses the device", async () => {
    const first = await login(null);
    if (first.kind !== "ok" || !first.deviceSecret) throw new Error();
    const second = await login(first.deviceSecret);
    expect(second).toMatchObject({ kind: "ok", deviceSecret: null });
    expect(await mem.db.collection("SecurityDevice").countDocuments()).toBe(1);
    if (second.kind === "ok") {
      // Same device: the previous session is replaced.
      expect((await lookupSession(mem.db, first.sessionId)).state).toBe("REVOKED");
      expect((await lookupSession(mem.db, second.sessionId)).state).toBe("VALID");
    }
  });

  it("records device events without secrets", async () => {
    const first = await login("garbage-cookie");
    if (first.kind !== "ok") throw new Error();
    const events = await mem.db.collection("SecurityEvent").find().toArray();
    expect(events.map((e) => e.type).sort()).toEqual(
      ["DEVICE_COOKIE_REJECTED", "DEVICE_REGISTERED", "SESSION_CREATED"].sort(),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(first.deviceSecret!);
    expect(serialized).not.toContain(first.sessionId!);
    expect(serialized).not.toContain("garbage-cookie");
  });

  it("device limit: shadow lets the login through, enforce refuses it", async () => {
    for (let i = 0; i < 3; i += 1) await login(null);
    const limited = await login(null);
    expect(limited).toEqual({ kind: "device-limit" });
    expect(loginSecurityGate(limited, ON)).toBeNull();

    const enforce = cfg({
      SECURITY_DEVICE_TRUST_ENABLED: "detect",
      SECURITY_SESSIONS_ENABLED: "enforce",
      SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
    });
    expect(loginSecurityGate(limited, enforce)).toMatchObject({ status: 403 });
    expect(loginSecurityGate("error", enforce)).toMatchObject({ status: 503 });
    expect(loginSecurityGate("error", ON)).toBeNull();
  });

  it("keeps the new device cookie when the session can't be started", async () => {
    const enforce = cfg({
      SECURITY_DEVICE_TRUST_ENABLED: "detect",
      SECURITY_SESSIONS_ENABLED: "enforce",
      SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
    });
    const failed = {
      kind: "ok" as const,
      deviceSecret: "x".repeat(43),
      sessionId: null,
      sessionFailed: true,
      pendingDevice: null,
    };
    expect(loginSecurityGate(failed, enforce)).toMatchObject({ status: 503 });
    expect(loginSecurityGate(failed, ON)).toBeNull();
    const jar = fakeJar();
    setLoginSecurityCookies(jar, failed, false, enforce);
    expect(jar.cookies.has("atelier_device")).toBe(true);
    expect(jar.deleted).toEqual(["atelier_sid"]);
  });

  it("clears a stale session cookie when no new session is issued", () => {
    const jar = fakeJar();
    setLoginSecurityCookies(jar, { kind: "device-limit" }, false, ON);
    expect(jar.deleted).toEqual(["atelier_sid"]);
  });
});
