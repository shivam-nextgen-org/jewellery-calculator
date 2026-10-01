import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_LIMIT,
  DEFAULT_EVICTION_POLICY,
  DEFAULT_MAX_CONCURRENT_SESSIONS,
  getSecurityConfig,
} from "@/lib/security/config";

const env = (values: Record<string, string>) =>
  ({ NODE_ENV: "test", ...values }) as NodeJS.ProcessEnv;

describe("security config", () => {
  it("defaults every flag to off and uses the approved limits", () => {
    const config = getSecurityConfig(env({}));
    expect(Object.values(config.flags).every((mode) => mode === "off")).toBe(true);
    expect(config.limits).toEqual({
      deviceLimit: DEFAULT_DEVICE_LIMIT,
      maxConcurrentSessions: DEFAULT_MAX_CONCURRENT_SESSIONS,
      evictionPolicy: DEFAULT_EVICTION_POLICY,
    });
    expect(config.limits).toEqual({
      deviceLimit: 3,
      maxConcurrentSessions: 1,
      evictionPolicy: "NEWEST_WINS",
    });
    expect(config.warnings).toEqual([]);
  });

  it("allows limits to be configured", () => {
    const config = getSecurityConfig(
      env({
        SECURITY_DEVICE_LIMIT: "5",
        SECURITY_MAX_CONCURRENT_SESSIONS: "2",
        SECURITY_EVICTION_POLICY: "deny_new",
      }),
    );
    expect(config.limits).toEqual({
      deviceLimit: 5,
      maxConcurrentSessions: 2,
      evictionPolicy: "DENY_NEW",
    });
  });

  it("rejects invalid limits and falls back to defaults with a warning", () => {
    for (const bad of ["0", "-1", "abc", "1.5", "11", "999"]) {
      const config = getSecurityConfig(env({ SECURITY_DEVICE_LIMIT: bad }));
      expect(config.limits.deviceLimit).toBe(3);
      expect(config.warnings.length).toBe(1);
    }
  });

  it("never turns an unknown flag value into an enforcing mode", () => {
    const config = getSecurityConfig(
      env({ SECURITY_ACCESS_DECISION: "yes-please", SECURITY_RISK_ENGINE_ENABLED: "LOG-ONLY" }),
    );
    expect(config.flags.accessDecision).toBe("off");
    expect(config.flags.riskEngine).toBe("log-only"); // case-insensitive valid value
    expect(config.warnings).toHaveLength(1);
  });

  it("I2 guards: sessions need device tracking and a cutover to enforce", () => {
    const noDevices = getSecurityConfig(env({ SECURITY_SESSIONS_ENABLED: "shadow" }));
    expect(noDevices.flags.sessions).toBe("off");

    const noCutover = getSecurityConfig(
      env({ SECURITY_SESSIONS_ENABLED: "enforce", SECURITY_DEVICE_TRUST_ENABLED: "detect" }),
    );
    expect(noCutover.flags.sessions).toBe("shadow");
    expect(noCutover.warnings.join(" ")).toMatch(/CUTOVER_AT/);

    const ok = getSecurityConfig(
      env({
        SECURITY_SESSIONS_ENABLED: "enforce",
        SECURITY_DEVICE_TRUST_ENABLED: "detect",
        SECURITY_SESSIONS_CUTOVER_AT: "2026-10-01T00:00:00Z",
      }),
    );
    expect(ok.flags.sessions).toBe("enforce");
    expect(ok.sessions.cutoverAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  describe("I4 concurrency guards", () => {
    const sessionsOn = {
      SECURITY_DEVICE_TRUST_ENABLED: "detect",
      SECURITY_SESSIONS_ENABLED: "enforce",
      SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
    };

    it("enforce is usable with enforced sessions and NEWEST_WINS", () => {
      const config = getSecurityConfig(env({ ...sessionsOn, SECURITY_CONCURRENCY_ENABLED: "enforce" }));
      expect(config.flags.concurrency).toBe("enforce");
      expect(config.limits).toMatchObject({ maxConcurrentSessions: 1, evictionPolicy: "NEWEST_WINS" });
      expect(config.warnings).toEqual([]);
    });

    it("needs server sessions at all", () => {
      const config = getSecurityConfig(env({ SECURITY_CONCURRENCY_ENABLED: "enforce" }));
      expect(config.flags.concurrency).toBe("off");
    });

    it("downgrades to detect when sessions are only in shadow", () => {
      const config = getSecurityConfig(
        env({ ...sessionsOn, SECURITY_SESSIONS_ENABLED: "shadow", SECURITY_CONCURRENCY_ENABLED: "enforce" }),
      );
      expect(config.flags.concurrency).toBe("detect");
    });

    it("downgrades to detect when sessions lose enforce for lack of a cutover", () => {
      const config = getSecurityConfig(
        env({ ...sessionsOn, SECURITY_SESSIONS_CUTOVER_AT: "", SECURITY_CONCURRENCY_ENABLED: "enforce" }),
      );
      expect(config.flags.sessions).toBe("shadow");
      expect(config.flags.concurrency).toBe("detect");
    });

    it("downgrades to detect for policies not implemented yet", () => {
      for (const policy of ["DENY_NEW", "STEP_UP"]) {
        const config = getSecurityConfig(
          env({ ...sessionsOn, SECURITY_CONCURRENCY_ENABLED: "enforce", SECURITY_EVICTION_POLICY: policy }),
        );
        expect(config.flags.concurrency).toBe("detect");
        expect(config.warnings.join(" ")).toMatch(/NEWEST_WINS/);
      }
    });
  });

  describe("I3 enforcement transition for device trust", () => {
    const ready = {
      NODE_ENV: "production",
      SECURITY_DEVICE_TRUST_ENABLED: "enforce",
      SECURITY_DEVICE_VERIFICATION_ENABLED: "on",
      SECURITY_SESSIONS_CUTOVER_AT: "2026-09-01T00:00:00Z",
    };

    it("is usable only when every prerequisite is present", () => {
      const config = getSecurityConfig(env(ready));
      expect(config.device.verificationAvailable).toBe(true);
      expect(config.flags.deviceTrust).toBe("enforce");
      expect(config.warnings).toEqual([]);
    });

    it.each([
      ["verification flag off", { SECURITY_DEVICE_VERIFICATION_ENABLED: "" }, /VERIFICATION_ENABLED=on/],
      ["insecure cookies", { COOKIE_SECURE: "false" }, /secure cookies/],
      ["no cutover", { SECURITY_SESSIONS_CUTOVER_AT: "" }, /CUTOVER_AT/],
    ])("downgrades to detect with %s", (_label, override, message) => {
      const config = getSecurityConfig(env({ ...ready, ...override }));
      expect(config.flags.deviceTrust).toBe("detect");
      expect(config.warnings.join(" ")).toMatch(message);
    });

    it("verification without device tracking is off", () => {
      const config = getSecurityConfig(env({ SECURITY_DEVICE_VERIFICATION_ENABLED: "on" }));
      expect(config.flags.deviceVerification).toBe("off");
    });

    it("uses the 24h pending window and the admin-approval verifier", () => {
      const config = getSecurityConfig(env({ SECURITY_DEVICE_VERIFIER: "email-otp" }));
      expect(config.device.pendingTtlHours).toBe(24);
      expect(config.device.verifier).toBe("admin-approval");
      expect(config.warnings.join(" ")).toMatch(/SECURITY_DEVICE_VERIFIER/);
    });
  });

  it("rejects a malformed cutover instead of guessing", () => {
    for (const bad of ["yesterday", "2026-10-01", "not-a-date"]) {
      const config = getSecurityConfig(env({ SECURITY_SESSIONS_CUTOVER_AT: bad }));
      expect(config.sessions.cutoverAt).toBeNull();
      expect(config.warnings).toHaveLength(1);
    }
  });

  it("downgrades device-trust enforcement when cookies are not secure", () => {
    const config = getSecurityConfig(
      env({ SECURITY_DEVICE_TRUST_ENABLED: "enforce", COOKIE_SECURE: "false" }),
    );
    expect(config.flags.deviceTrust).toBe("detect");
    expect(config.warnings.join(" ")).toMatch(/secure cookies/);
  });

  it("uses the approved retention defaults", () => {
    const { retention } = getSecurityConfig(env({}));
    expect(retention.securityEventDays).toBe(180);
    expect(retention.riskAssessmentDays).toBe(180);
    expect(retention.revokedDeviceDays).toBe(400);
    expect(retention.sessionMaxDays).toBe(30);
    expect(retention.adminActionMinDays).toBeGreaterThanOrEqual(730);
    expect(retention.otpChallengeMaxHours).toBeLessThanOrEqual(24);
  });
});
