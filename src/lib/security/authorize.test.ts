import { describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/auth/errors";
import type { SessionUser } from "@/lib/auth/token";
import {
  accountStateFromUser,
  authorize,
  decideAccess,
  type AccountState,
  type AuthorizeDeps,
  type Principal,
} from "@/lib/security/authorize";
import { getSecurityConfig } from "@/lib/security/config";
import type { SecurityContext } from "@/lib/security/context";

const customer: SessionUser = {
  id: "65a000000000000000000001",
  email: "customer@example.com",
  name: "Customer",
  role: "USER",
};
const admin: SessionUser = {
  id: "65a000000000000000000002",
  email: "admin@example.com",
  name: "Admin",
  role: "SUPER_ADMIN",
};
const asSession = (user: SessionUser): Principal => ({ kind: "SESSION", user });
const active = (role: SessionUser["role"]): AccountState => ({
  state: "FOUND",
  role,
  status: "ACTIVE",
});

describe("decideAccess", () => {
  it("allows an authenticated, active user", () => {
    expect(
      decideAccess({ requirement: "USER", principal: asSession(customer), account: active("USER") }),
    ).toEqual({ allow: true, status: 200, reasons: [] });
  });

  it("denies an unauthenticated request with 401", () => {
    expect(
      decideAccess({ requirement: "USER", principal: null, account: { state: "NOT_FOUND" } }),
    ).toMatchObject({ allow: false, status: 401, reasons: ["UNAUTHENTICATED"] });
  });

  it("denies the wrong role with 403 in both directions", () => {
    expect(
      decideAccess({ requirement: "ADMIN", principal: asSession(customer), account: active("USER") }),
    ).toMatchObject({ allow: false, status: 403, reasons: ["ROLE_NOT_PERMITTED"] });
    expect(
      decideAccess({ requirement: "USER", principal: asSession(admin), account: active("SUPER_ADMIN") }),
    ).toMatchObject({ allow: false, status: 403 });
  });

  it("never lets an API key act as an admin", () => {
    expect(
      decideAccess({
        requirement: "ADMIN",
        principal: { kind: "API_KEY", user: admin },
        account: active("SUPER_ADMIN"),
      }),
    ).toMatchObject({ allow: false, status: 403 });
  });

  it("trusts the live account, not the token's claims", () => {
    // Token says USER, database says the user was demoted/changed.
    expect(
      decideAccess({
        requirement: "USER",
        principal: asSession(customer),
        account: { state: "FOUND", role: "SUPER_ADMIN", status: "ACTIVE" },
      }),
    ).toMatchObject({ allow: false, status: 403, reasons: ["ROLE_CHANGED"] });
    // Token is valid but the account no longer exists.
    expect(
      decideAccess({ requirement: "USER", principal: asSession(customer), account: { state: "NOT_FOUND" } }),
    ).toMatchObject({ allow: false, status: 401, reasons: ["ACCOUNT_NOT_FOUND"] });
  });

  it("denies restricted accounts with a reason for each status", () => {
    const cases = [
      ["SUSPENDED", "ACCOUNT_SUSPENDED"],
      ["REVOKED", "ACCESS_REVOKED"],
      ["TEMPORARILY_RESTRICTED", "ACCOUNT_TEMPORARILY_RESTRICTED"],
    ] as const;
    for (const [status, reason] of cases) {
      expect(
        decideAccess({
          requirement: "USER",
          principal: asSession(customer),
          account: { state: "FOUND", role: "USER", status },
        }),
      ).toMatchObject({ allow: false, status: 403, reasons: [reason] });
    }
  });

  it("keeps REVIEW_REQUIRED accounts working but flags them", () => {
    expect(
      decideAccess({
        requirement: "USER",
        principal: asSession(customer),
        account: { state: "FOUND", role: "USER", status: "REVIEW_REQUIRED" },
      }),
    ).toEqual({ allow: true, status: 200, reasons: ["REVIEW_REQUIRED"] });
  });

  it("fails closed when account state can't be read", () => {
    expect(
      decideAccess({ requirement: "USER", principal: asSession(customer), account: { state: "UNAVAILABLE" } }),
    ).toMatchObject({ allow: false, status: 503 });
  });

  it("already supports later session and device inputs", () => {
    const base = { requirement: "USER" as const, principal: asSession(customer), account: active("USER") };
    expect(decideAccess({ ...base, session: "REVOKED" })).toMatchObject({ status: 401, reasons: ["SESSION_REVOKED"] });
    expect(decideAccess({ ...base, session: "EXPIRED" })).toMatchObject({ status: 401 });
    expect(decideAccess({ ...base, session: "EVICTED" })).toMatchObject({ status: 401, reasons: ["SESSION_EVICTED"] });
    expect(decideAccess({ ...base, session: "VALID", device: "MISMATCH" })).toMatchObject({
      status: 401,
      reasons: ["SESSION_DEVICE_MISMATCH"],
    });
    expect(decideAccess({ ...base, session: "VALID", device: "MATCH" }).allow).toBe(true);
  });
});

describe("accountStateFromUser", () => {
  it("maps the existing user fields", () => {
    expect(accountStateFromUser({ role: "USER", isActive: true })).toEqual(active("USER"));
    expect(accountStateFromUser({ role: "USER", isActive: false })).toMatchObject({ status: "SUSPENDED" });
    expect(accountStateFromUser({ role: "USER" })).toMatchObject({ status: "SUSPENDED" });
    expect(accountStateFromUser({ role: "ROOT", isActive: true })).toEqual({ state: "NOT_FOUND" });
    expect(accountStateFromUser(null)).toEqual({ state: "NOT_FOUND" });
  });
});

const NO_CONTEXT: SecurityContext = {
  session: "NOT_EVALUATED",
  device: "NOT_EVALUATED",
  sessionRef: null,
  deviceId: null,
};

function deps(
  flag: string,
  account: AccountState | (() => Promise<AccountState>),
): AuthorizeDeps & {
  loadAccount: ReturnType<typeof vi.fn>;
  loadContext: ReturnType<typeof vi.fn>;
  recordEvent: ReturnType<typeof vi.fn>;
} {
  return {
    config: getSecurityConfig({ NODE_ENV: "test", SECURITY_ACCESS_DECISION: flag } as NodeJS.ProcessEnv),
    loadAccount: vi.fn(typeof account === "function" ? account : async () => account),
    loadContext: vi.fn(async () => NO_CONTEXT),
    recordEvent: vi.fn(async () => true),
  };
}

describe("authorize() rollout modes", () => {
  const suspended: AccountState = { state: "FOUND", role: "USER", status: "SUSPENDED" };

  it("off: does not read the database and never blocks", async () => {
    const d = deps("off", suspended);
    const result = await authorize(asSession(customer), "USER", d);
    expect(result).toEqual({ mode: "off", decision: null });
    expect(d.loadAccount).not.toHaveBeenCalled();
    expect(d.recordEvent).not.toHaveBeenCalled();
  });

  it("defaults to off when the flag is unset", async () => {
    const result = await authorize(asSession(customer), "USER", {
      ...deps("", suspended),
      config: getSecurityConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    });
    expect(result.mode).toBe("off");
  });

  it("shadow: records a would-deny event but lets the request through", async () => {
    const d = deps("shadow", suspended);
    const result = await authorize(asSession(customer), "USER", d);
    expect(result.decision).toMatchObject({ allow: false, reasons: ["ACCOUNT_SUSPENDED"] });
    expect(d.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ACCESS_WOULD_DENY", reasonCodes: ["ACCOUNT_SUSPENDED"] }),
    );
  });

  it("enforce: blocks a restricted user with AuthError and records it", async () => {
    const d = deps("enforce", suspended);
    await expect(authorize(asSession(customer), "USER", d)).rejects.toMatchObject({
      status: 403,
    });
    await expect(authorize(asSession(customer), "USER", d)).rejects.toBeInstanceOf(AuthError);
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "ACCESS_DENIED" }));
  });

  it("enforce: allows an active user without recording a denial", async () => {
    const d = deps("enforce", active("USER"));
    const result = await authorize(asSession(customer), "USER", d);
    expect(result.decision?.allow).toBe(true);
    expect(d.recordEvent).not.toHaveBeenCalled();
  });

  it("enforce: fails closed with 503 if the account lookup throws", async () => {
    const d = deps("enforce", async () => {
      throw new Error("db down");
    });
    await expect(authorize(asSession(customer), "USER", d)).rejects.toMatchObject({ status: 503 });
  });

  it("a failing event writer never changes the outcome", async () => {
    const d = deps("shadow", suspended);
    d.recordEvent.mockRejectedValue(new Error("event store down"));
    await expect(authorize(asSession(customer), "USER", d)).resolves.toMatchObject({ mode: "shadow" });

    const e = deps("enforce", active("USER"));
    e.recordEvent.mockRejectedValue(new Error("event store down"));
    await expect(authorize(asSession(customer), "USER", e)).resolves.toMatchObject({ mode: "enforce" });
  });

  it("records the admin actor type for admin principals", async () => {
    const d = deps("shadow", { state: "FOUND", role: "SUPER_ADMIN", status: "SUSPENDED" });
    await authorize(asSession(admin), "ADMIN", d);
    expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ actorType: "ADMIN" }));
  });
});

describe("authorize() I2 session/device components", () => {
  const cfg = (values: Record<string, string>) =>
    getSecurityConfig({ NODE_ENV: "test", ...values } as NodeJS.ProcessEnv);
  const context = (session: SecurityContext["session"], device: SecurityContext["device"]) =>
    ({ ...NO_CONTEXT, session, device }) satisfies SecurityContext;

  function withContext(values: Record<string, string>, ctx: SecurityContext) {
    const d = deps("enforce", active("USER"));
    d.config = cfg({ SECURITY_ACCESS_DECISION: "enforce", ...values });
    d.loadContext.mockResolvedValue(ctx);
    return d;
  }

  it("does not load session/device context for API keys or admins", async () => {
    const d = withContext({ SECURITY_DEVICE_TRUST_ENABLED: "detect" }, context("REVOKED", "REVOKED"));
    await authorize({ kind: "API_KEY", user: customer }, "USER", d);
    d.loadAccount.mockResolvedValue(active("SUPER_ADMIN"));
    await authorize(asSession(admin), "ADMIN", d);
    expect(d.loadContext).not.toHaveBeenCalled();
  });

  it("session in shadow: a revoked session is recorded but never blocks", async () => {
    const d = withContext(
      {
        SECURITY_DEVICE_TRUST_ENABLED: "detect",
        SECURITY_SESSIONS_ENABLED: "shadow",
      },
      context("REVOKED", "MATCH"),
    );
    const result = await authorize(asSession(customer), "USER", d);
    expect(result.decision).toMatchObject({ allow: false, reasons: ["SESSION_REVOKED"] });
    expect(d.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ACCESS_WOULD_DENY", reasonCodes: ["SESSION_REVOKED"] }),
    );
  });

  it("session enforced: a revoked or missing session blocks with 401", async () => {
    const values = {
      SECURITY_DEVICE_TRUST_ENABLED: "detect",
      SECURITY_SESSIONS_ENABLED: "enforce",
      SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
    };
    for (const session of ["REVOKED", "NOT_FOUND", "EXPIRED"] as const) {
      const d = withContext(values, context(session, "MATCH"));
      await expect(authorize(asSession(customer), "USER", d)).rejects.toMatchObject({ status: 401 });
      expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "ACCESS_DENIED" }));
    }
  });

  it("device is only detected in I2: an untrusted device never blocks", async () => {
    const d = withContext(
      {
        SECURITY_DEVICE_TRUST_ENABLED: "enforce", // downgraded to detect in I2
        SECURITY_SESSIONS_ENABLED: "enforce",
        SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
        COOKIE_SECURE: "true",
      },
      context("VALID", "UNTRUSTED"),
    );
    expect(d.config.flags.deviceTrust).toBe("detect");
    const result = await authorize(asSession(customer), "USER", d);
    expect(result.decision?.reasons).toEqual(["DEVICE_NOT_TRUSTED"]);
  });

  it("device enforced (once I3 allows it): mismatch blocks and emits a mismatch event", async () => {
    const d = withContext({}, context("VALID", "MISMATCH"));
    d.config = {
      ...d.config,
      flags: { ...d.config.flags, deviceTrust: "enforce", sessions: "enforce" },
    };
    await expect(authorize(asSession(customer), "USER", d)).rejects.toMatchObject({ status: 401 });
    expect(d.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SESSION_DEVICE_MISMATCH", metadata: { blocked: true } }),
    );
  });

  it("an unreadable session store fails closed only when sessions are enforced", async () => {
    const unavailable = context("UNAVAILABLE", "UNAVAILABLE");
    const shadow = withContext(
      { SECURITY_DEVICE_TRUST_ENABLED: "detect", SECURITY_SESSIONS_ENABLED: "shadow" },
      unavailable,
    );
    await expect(authorize(asSession(customer), "USER", shadow)).resolves.toBeTruthy();

    const enforced = withContext(
      {
        SECURITY_DEVICE_TRUST_ENABLED: "detect",
        SECURITY_SESSIONS_ENABLED: "enforce",
        SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
      },
      unavailable,
    );
    await expect(authorize(asSession(customer), "USER", enforced)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("account restrictions still block regardless of session/device flags", async () => {
    const d = withContext({}, NO_CONTEXT);
    d.loadAccount.mockResolvedValue({ state: "FOUND", role: "USER", status: "SUSPENDED" });
    await expect(authorize(asSession(customer), "USER", d)).rejects.toMatchObject({ status: 403 });
  });
});
