import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_THRESHOLDS, getSecurityConfig, type RiskThresholds } from "@/lib/security/config";
import {
  evaluateRiskEvents,
  extractSignals,
  FUTURE_SKEW_MS,
  SUPPORTING_CAP,
  type RiskEvent,
} from "@/lib/security/risk-rules";

const T: RiskThresholds = { ...DEFAULT_RISK_THRESHOLDS };
const NOW = new Date("2026-10-01T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

let seq = 0;
function ev(type: string, minutesAgo: number, extra: Partial<RiskEvent> = {}): RiskEvent {
  seq += 1;
  return {
    id: `e${String(seq).padStart(6, "0")}`,
    type,
    occurredAt: new Date(NOW.getTime() - minutesAgo * MIN),
    ...extra,
  };
}
/** Session starts on devices, one per `gapMinutes`, ending `endMinutesAgo` ago. */
function starts(devices: string[], gapMinutes = 10, endMinutesAgo = 0, extra: (i: number) => Partial<RiskEvent> = () => ({})) {
  const n = devices.length;
  return devices.map((deviceId, i) =>
    ev("SESSION_CREATED", endMinutesAgo + (n - 1 - i) * gapMinutes, { deviceId, ...extra(i) }),
  );
}
const evicted = (minutesAgo: number, ref: string, sameDevice = false) =>
  ev("SESSION_EVICTED", minutesAgo, { sessionRef: ref, metadata: { sameDevice } });
const run = (events: RiskEvent[], t: RiskThresholds = T) => evaluateRiskEvents(events, NOW, t);

describe("no events / benign use", () => {
  it("no events is LOW / ALLOW with no reasons", () => {
    const r = run([]);
    expect(r).toMatchObject({ tier: "LOW", score: 0, reasonCodes: [], recommendedAction: "ALLOW" });
  });

  it("laptop at home, same laptop at office, phone in the evening", () => {
    const r = run([
      ...starts(["laptop"], 0, 600, () => ({ ipHash: "home", coarseGeo: "IN" })),
      ...starts(["laptop"], 0, 300, () => ({ ipHash: "office", coarseGeo: "IN" })),
      ...starts(["phone"], 0, 30, () => ({ ipHash: "mobile", coarseGeo: "IN" })),
      evicted(30, "s1"),
    ]);
    expect(r.tier).toBe("LOW");
    expect(r.reasonCodes).toEqual([]);
  });

  it("many IP / VPN / mobile-network changes on one device are ignored", () => {
    const r = run(starts(Array(8).fill("laptop"), 5, 0, (i) => ({ ipHash: `ip${i}` })));
    expect(r.signals.networks).toBe(8);
    expect(r.reasonCodes).toEqual([]);
    expect(r.tier).toBe("LOW");
  });

  it("travel: several countries on one device are ignored", () => {
    const r = run(starts(["laptop", "laptop", "laptop"], 20, 0, (i) => ({ coarseGeo: ["IN", "AE", "GB"][i] })));
    expect(r.signals.countries).toBe(0);
    expect(r.tier).toBe("LOW");
  });

  it("normal laptop/phone use a few times a day stays LOW", () => {
    const r = run([
      ...starts(["laptop", "phone", "laptop", "phone", "laptop"], 180),
      evicted(720, "a"), evicted(540, "b"), evicted(360, "c"), evicted(180, "d"),
    ]);
    expect(r.signals.switches).toBe(4);
    expect(r.signals.evictions).toBe(0); // spread out: none within the 60-minute window
    expect(r.tier).toBe("LOW");
  });
});

describe("individual signals (each alone is at most MEDIUM)", () => {
  const cases: [string, RiskEvent[]][] = [
    ["RAPID_SESSION_EVICTION", [evicted(5, "a"), evicted(15, "b"), evicted(25, "c")]],
    ["DEVICE_PING_PONG", starts(["a", "b", "a", "b", "a", "b"], 20)],
    ["SESSION_DEVICE_MISMATCH", [ev("SESSION_DEVICE_MISMATCH", 10)]],
    ["MULTI_DEVICE_BURST", starts(["a", "b", "c"], 2, 600)],
    ["FREQUENT_DEVICE_SWITCHING", starts(["a", "b", "c", "a", "b", "c", "a", "b", "c"], 150)],
    ["DEVICE_CHURN", Array.from({ length: 4 }, (_, i) => ev("DEVICE_REGISTERED", i * 1440))],
    ["REPEATED_DENIED_DEVICES", [ev("DEVICE_REJECTED", 60), ev("DEVICE_EXPIRED", 5000)]],
    ["LOGIN_FAILURE_BURST", Array.from({ length: 5 }, (_, i) => ev("LOGIN_FAILED", i * 5))],
    ["DEVICE_LIMIT_PRESSURE", [ev("DEVICE_LIMIT_REACHED", 60), ev("DEVICE_LIMIT_REACHED", 3000)]],
  ];

  it.each(cases)("%s", (code, events) => {
    const r = run(events);
    expect(r.reasonCodes).toContain(code);
    expect(["LOW", "MEDIUM"]).toContain(r.tier);
    const c = r.contributions.find((x) => x.code === code)!;
    expect(c.value).toBeGreaterThanOrEqual(c.threshold);
  });

  it("the burst scenario from the brief: A 10:00, B 10:02, C 10:04, D 10:05", () => {
    const r = run(starts(["A", "B", "C", "D"], 2));
    expect(r.signals.burstDevices).toBe(4);
    expect(r.reasonCodes).toContain("MULTI_DEVICE_BURST");
  });
});

describe("combinations", () => {
  it("two behavioural signals can reach HIGH (recommend RESTRICT)", () => {
    const r = run([
      ...starts(["a", "b", "a", "b", "a", "b"], 5),
      evicted(5, "1"), evicted(10, "2"), evicted(15, "3"),
    ]);
    expect(r.reasonCodes).toEqual(expect.arrayContaining(["RAPID_SESSION_EVICTION", "DEVICE_PING_PONG"]));
    expect(r.tier).toBe("HIGH");
    expect(r.recommendedAction).toBe("RESTRICT");
  });

  it("sharing with many people reaches CRITICAL (recommend REVIEW)", () => {
    const devices = ["a", "b", "c", "d", "a", "b", "c", "d", "a", "b"];
    const r = run([
      ...starts(devices, 5, 0, (i) => ({ ipHash: `ip${i % 4}`, coarseGeo: i % 2 ? "IN" : "US" })),
      ...Array.from({ length: 5 }, (_, i) => evicted(i * 5, `s${i}`)),
    ]);
    expect(r.tier).toBe("CRITICAL");
    expect(r.recommendedAction).toBe("REVIEW");
    expect(r.reasonCodes).toEqual(
      expect.arrayContaining(["RAPID_SESSION_EVICTION", "MULTI_DEVICE_BURST", "FREQUENT_DEVICE_SWITCHING"]),
    );
    // Rotating through 4 devices isn't A→B→A ping-pong.
    expect(r.reasonCodes).not.toContain("DEVICE_PING_PONG");
  });

  it("a single signal can't go above MEDIUM however extreme", () => {
    const r = run(Array.from({ length: 50 }, (_, i) => ev("LOGIN_FAILED", i)), { ...T, mediumScore: 1, highScore: 2, criticalScore: 3 });
    expect(r.tier).toBe("MEDIUM");
  });

  it("two signals can't reach CRITICAL even with a huge score", () => {
    const r = run(
      [...Array.from({ length: 9 }, (_, i) => ev("LOGIN_FAILED", i)), ev("SESSION_DEVICE_MISMATCH", 1)],
      { ...T, mediumScore: 1, highScore: 2, criticalScore: 3 },
    );
    expect(r.tier).toBe("HIGH");
  });
});

describe("supporting signals (network / geo)", () => {
  const networks = starts(["a", "a", "a", "a"], 5, 0, (i) => ({ ipHash: `ip${i}` }));

  it("network dispersion alone adds nothing", () => {
    expect(run(networks)).toMatchObject({ tier: "LOW", reasonCodes: [], score: 0 });
  });

  it("geo across devices alone adds nothing", () => {
    const r = run(starts(["a", "b"], 30, 0, (i) => ({ coarseGeo: i ? "US" : "IN" })));
    expect(r.signals.countries).toBe(2);
    expect(r.reasonCodes).toEqual([]);
  });

  it("they add capped weight next to a behavioural signal", () => {
    const r = run([
      ...starts(["a", "b", "c", "d"], 2, 0, (i) => ({ ipHash: `ip${i}`, coarseGeo: i % 2 ? "US" : "IN" })),
    ]);
    const supporting = r.contributions.filter((c) => c.code === "NETWORK_DISPERSION" || c.code === "GEO_DISPERSION");
    expect(supporting.length).toBeGreaterThan(0);
    expect(supporting.reduce((s, c) => s + c.weight, 0)).toBeLessThanOrEqual(SUPPORTING_CAP);
    expect(r.tier).toBe("MEDIUM"); // still only one behavioural signal
  });
});

describe("thresholds and time windows", () => {
  it("one below a threshold doesn't fire; at the threshold it does", () => {
    expect(run([evicted(5, "a"), evicted(6, "b")]).reasonCodes).toEqual([]);
    expect(run([evicted(5, "a"), evicted(6, "b"), evicted(7, "c")]).reasonCodes).toEqual(["RAPID_SESSION_EVICTION"]);
  });

  it("thresholds are configurable", () => {
    const strict = { ...T, evictionCount: 1 };
    expect(run([evicted(5, "a")], strict).reasonCodes).toEqual(["RAPID_SESSION_EVICTION"]);
  });

  it("window edge: an event exactly at the window start is outside", () => {
    const edge = [evicted(60, "a"), evicted(10, "b"), evicted(20, "c")];
    expect(run(edge).signals.evictions).toBe(2);
    const inside = [evicted(59.99, "a"), evicted(10, "b"), evicted(20, "c")];
    expect(run(inside).signals.evictions).toBe(3);
  });

  it("risk falls again once events leave the window (not permanent)", () => {
    const events = [evicted(5, "a"), evicted(6, "b"), evicted(7, "c")];
    expect(run(events).tier).toBe("MEDIUM");
    const later = evaluateRiskEvents(events, new Date(NOW.getTime() + 2 * HOUR), T);
    expect(later.tier).toBe("LOW");
  });
});

describe("data quality", () => {
  it("repeated identical events (same id) count once", () => {
    const one = ev("LOGIN_FAILED", 1);
    const r = run(Array(10).fill(one));
    expect(r.signals.loginFailures).toBe(1);
    expect(r.dataQuality.duplicatesIgnored).toBe(9);
  });

  it("the same evicted session reported twice counts once", () => {
    const r = run([evicted(5, "same"), evicted(6, "same"), evicted(7, "same")]);
    expect(r.signals.evictions).toBe(1);
  });

  it("same-device replacements are not evictions", () => {
    expect(run([evicted(5, "a", true), evicted(6, "b", true), evicted(7, "c", true)]).signals.evictions).toBe(0);
  });

  it("detect-mode would-evict counts are used (and bounded)", () => {
    const r = run([
      ev("CONCURRENT_SESSION_DETECTED", 5, { metadata: { mode: "detect", wouldEvict: 2 } }),
      ev("CONCURRENT_SESSION_DETECTED", 6, { metadata: { mode: "detect", wouldEvict: 1_000_000 } }),
      ev("CONCURRENT_SESSION_DETECTED", 7, { metadata: { mode: "enforce", evicted: 5 } }),
    ]);
    expect(r.signals.evictions).toBe(12);
  });

  it("missing device ids, metadata or bad values don't break evaluation", () => {
    const r = run([
      ev("SESSION_CREATED", 1),
      ev("SESSION_CREATED", 2, { deviceId: null, metadata: null }),
      ev("SESSION_EVICTED", 3, {}),
      ev("CONCURRENT_SESSION_DETECTED", 4, { metadata: { mode: "detect", wouldEvict: "lots" } }),
      { id: "bad", type: "LOGIN_FAILED", occurredAt: new Date("not a date") },
      null as unknown as RiskEvent,
    ]);
    expect(r.dataQuality.missingDevice).toBe(2);
    expect(r.tier).toBe("LOW");
  });

  it("order of input doesn't matter; ties break by id", () => {
    const events = [...starts(["a", "b", "a", "b", "a", "b"], 5), evicted(1, "x"), evicted(2, "y"), evicted(3, "z")];
    const shuffled = [...events].reverse();
    expect(run(shuffled)).toEqual(run(events));

    const same = new Date(NOW.getTime() - MIN);
    const tie = [
      { id: "b", type: "SESSION_CREATED", occurredAt: same, deviceId: "d2" },
      { id: "a", type: "SESSION_CREATED", occurredAt: same, deviceId: "d1" },
    ];
    expect(extractSignals(tie, NOW, T).signals.switches).toBe(1);
  });

  it("events far in the future are ignored; small clock skew is tolerated", () => {
    const future = ev("LOGIN_FAILED", -(FUTURE_SKEW_MS / MIN + 1));
    const skewed = ev("LOGIN_FAILED", -1);
    const r = run([future, skewed]);
    expect(r.dataQuality.futureIgnored).toBe(1);
    expect(r.signals.loginFailures).toBe(1);
  });

  it("is deterministic: same input, same result and fingerprint", () => {
    const events = [...starts(["a", "b", "c"], 2), ev("SESSION_DEVICE_MISMATCH", 1)];
    const a = run(events);
    const b = run(events.map((e) => ({ ...e })));
    expect(a).toEqual(b);
    expect(a.fingerprint).toMatch(/^[a-f0-9]{24}$/);
  });

  it("the fingerprint changes with the ruleset (thresholds)", () => {
    const events = [ev("SESSION_DEVICE_MISMATCH", 1)];
    expect(run(events).fingerprint).not.toBe(run(events, { ...T, mismatchCount: 2 }).fingerprint);
  });
});

describe("configuration", () => {
  it("accepts overrides and rejects bad values", () => {
    const config = getSecurityConfig({
      NODE_ENV: "test",
      SECURITY_RISK_THRESHOLDS: JSON.stringify({ evictionCount: 5, switchCount: -1, bogus: 3, churnWindowDays: 400 }),
    } as NodeJS.ProcessEnv);
    expect(config.risk.evictionCount).toBe(5);
    expect(config.risk.switchCount).toBe(DEFAULT_RISK_THRESHOLDS.switchCount);
    expect(config.risk.churnWindowDays).toBe(30);
    expect(config.warnings.join(" ")).toMatch(/switchCount/);
    expect(config.warnings.join(" ")).toMatch(/bogus/);
  });

  it("rejects non-increasing score bands and invalid JSON", () => {
    const bands = getSecurityConfig({ NODE_ENV: "test", SECURITY_RISK_THRESHOLDS: '{"highScore":10}' } as NodeJS.ProcessEnv);
    expect(bands.risk.highScore).toBe(DEFAULT_RISK_THRESHOLDS.highScore);
    const bad = getSecurityConfig({ NODE_ENV: "test", SECURITY_RISK_THRESHOLDS: "{" } as NodeJS.ProcessEnv);
    expect(bad.risk).toEqual(DEFAULT_RISK_THRESHOLDS);
  });

  it("risk engine: default off; act needs restrictions on and an enforced access decision", () => {
    expect(getSecurityConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv).flags.riskEngine).toBe("off");
    const act = getSecurityConfig({ NODE_ENV: "test", SECURITY_RISK_ENGINE_ENABLED: "act" } as NodeJS.ProcessEnv);
    expect(act.flags.riskEngine).toBe("log-only");
    expect(act.warnings.join(" ")).toMatch(/SECURITY_RESTRICTIONS_ENABLED=on/);
    expect(act.warnings.join(" ")).toMatch(/SECURITY_ACCESS_DECISION=enforce/);
    const half = getSecurityConfig({
      NODE_ENV: "test", SECURITY_RISK_ENGINE_ENABLED: "act", SECURITY_RESTRICTIONS_ENABLED: "on",
    } as NodeJS.ProcessEnv);
    expect(half.flags.riskEngine).toBe("log-only");
    const ready = getSecurityConfig({
      NODE_ENV: "test", SECURITY_RISK_ENGINE_ENABLED: "act", SECURITY_RESTRICTIONS_ENABLED: "on",
      SECURITY_ACCESS_DECISION: "enforce",
    } as NodeJS.ProcessEnv);
    expect(ready.flags.riskEngine).toBe("act");
    expect(ready.restrictions).toEqual({ highHours: 24, criticalDays: 7 });
  });

  it("restriction durations are configurable and bounded", () => {
    const c = getSecurityConfig({
      NODE_ENV: "test", SECURITY_RESTRICTION_HIGH_HOURS: "12", SECURITY_RESTRICTION_CRITICAL_DAYS: "3",
    } as NodeJS.ProcessEnv);
    expect(c.restrictions).toEqual({ highHours: 12, criticalDays: 3 });
    const bad = getSecurityConfig({
      NODE_ENV: "test", SECURITY_RESTRICTION_HIGH_HOURS: "0", SECURITY_RESTRICTION_CRITICAL_DAYS: "999",
    } as NodeJS.ProcessEnv);
    expect(bad.restrictions).toEqual({ highHours: 24, criticalDays: 7 });
    const inverted = getSecurityConfig({
      NODE_ENV: "test", SECURITY_RESTRICTION_HIGH_HOURS: "72", SECURITY_RESTRICTION_CRITICAL_DAYS: "1",
    } as NodeJS.ProcessEnv);
    expect(inverted.restrictions).toEqual({ highHours: 24, criticalDays: 7 });
  });
});
