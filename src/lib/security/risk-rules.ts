import { createHash } from "node:crypto";
import type { RiskAction, RiskTier } from "@/lib/security/collections";
import type { RiskThresholds } from "@/lib/security/config";

/**
 * Deterministic, explainable risk rules (I5, doc 04 §7 / doc 05 §6).
 *
 *   events ─▶ extractSignals() ─▶ RULES ─▶ contributions + reason codes
 *          ─▶ score ─▶ tier (score bands + multi-signal caps) ─▶ recommended action
 *
 * Pure: no I/O, no clock. The same events, thresholds and `now` always give
 * the same result. Nothing here acts on the result (restrictions are I6).
 *
 * False-positive protections built in:
 *  - Network and geo signals are SUPPORTING only: they add weight only when
 *    at least one behavioural signal fired, and together add at most
 *    SUPPORTING_CAP. An IP, VPN, mobile-network or country change on its own
 *    never raises risk.
 *  - Geo only counts across different devices (travel or a VPN on one device
 *    is ignored).
 *  - One behavioural signal can reach MEDIUM at most (recommend step-up,
 *    never restriction); HIGH needs 2 distinct behavioural signals and
 *    CRITICAL needs 3.
 *  - Same-device re-logins are not switches or evictions.
 *  - Duplicate events (same id) and events dated far in the future are
 *    ignored; everything else is ordered by time then id.
 */

export const RULESET_VERSION_BASE = "risk-v1";

/** Weights are part of the ruleset version (changing one changes the version). */
export const RULES = [
  { code: "RAPID_SESSION_EVICTION", kind: "behavioral", weight: 30 },
  { code: "DEVICE_PING_PONG", kind: "behavioral", weight: 30 },
  { code: "SESSION_DEVICE_MISMATCH", kind: "behavioral", weight: 30 },
  { code: "MULTI_DEVICE_BURST", kind: "behavioral", weight: 25 },
  { code: "FREQUENT_DEVICE_SWITCHING", kind: "behavioral", weight: 20 },
  { code: "DEVICE_CHURN", kind: "behavioral", weight: 20 },
  { code: "REPEATED_DENIED_DEVICES", kind: "behavioral", weight: 20 },
  { code: "LOGIN_FAILURE_BURST", kind: "behavioral", weight: 20 },
  { code: "DEVICE_LIMIT_PRESSURE", kind: "behavioral", weight: 15 },
  { code: "NETWORK_DISPERSION", kind: "supporting", weight: 10 },
  { code: "GEO_DISPERSION", kind: "supporting", weight: 10 },
] as const;

export type RiskReasonCode = (typeof RULES)[number]["code"];

/** Most network/geo can add, and only alongside a behavioural signal. */
export const SUPPORTING_CAP = 15;

/** Events dated further ahead than this are treated as untrustworthy. */
export const FUTURE_SKEW_MS = 5 * 60_000;

export type RiskEvent = {
  id: string;
  type: string;
  occurredAt: Date;
  deviceId?: string | null;
  sessionRef?: string | null;
  ipHash?: string | null;
  coarseGeo?: string | null;
  reasonCodes?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type RiskSignals = {
  evictions: number;
  switches: number;
  pingPongs: number;
  burstDevices: number;
  newDevices: number;
  deniedDevices: number;
  limitReached: number;
  mismatches: number;
  loginFailures: number;
  networks: number;
  countries: number;
};

export type DataQuality = {
  eventsConsidered: number;
  duplicatesIgnored: number;
  futureIgnored: number;
  missingDevice: number;
};

export type Contribution = { code: RiskReasonCode; weight: number; value: number; threshold: number };

export type RiskResult = {
  tier: RiskTier;
  score: number;
  reasonCodes: RiskReasonCode[];
  contributions: Contribution[];
  recommendedAction: RiskAction;
  signals: RiskSignals;
  dataQuality: DataQuality;
  rulesetVersion: string;
  fingerprint: string;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function num(value: unknown, max = 100): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(0, Math.floor(value)), max) : 0;
}

/** Sort by time, then id; drop duplicates and far-future events. */
export function normalizeEvents(events: RiskEvent[], now: Date): { events: RiskEvent[]; quality: DataQuality } {
  const seen = new Set<string>();
  const quality: DataQuality = { eventsConsidered: 0, duplicatesIgnored: 0, futureIgnored: 0, missingDevice: 0 };
  const kept: RiskEvent[] = [];
  for (const event of events) {
    if (!event || typeof event.type !== "string" || !(event.occurredAt instanceof Date)) continue;
    if (Number.isNaN(event.occurredAt.getTime())) continue;
    if (seen.has(event.id)) {
      quality.duplicatesIgnored += 1;
      continue;
    }
    seen.add(event.id);
    if (event.occurredAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      quality.futureIgnored += 1;
      continue;
    }
    kept.push(event);
  }
  kept.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  quality.eventsConsidered = kept.length;
  return { events: kept, quality };
}

function within(event: RiskEvent, now: Date, ms: number) {
  return event.occurredAt.getTime() > now.getTime() - ms;
}

export function extractSignals(
  input: RiskEvent[],
  now: Date,
  t: RiskThresholds,
): { signals: RiskSignals; quality: DataQuality } {
  const { events, quality } = normalizeEvents(input, now);
  const count = (type: string, ms: number, extra: (e: RiskEvent) => boolean = () => true) =>
    events.filter((e) => e.type === type && within(e, now, ms) && extra(e)).length;

  // Evictions: enforce mode (SESSION_EVICTED, one per evicted session,
  // same-device replacements excluded) + detect mode (would-evict counts).
  const evictionMs = t.evictionWindowMinutes * MIN;
  const evictedRefs = new Set<string>();
  let evictions = 0;
  for (const e of events) {
    if (!within(e, now, evictionMs)) continue;
    if (e.type === "SESSION_EVICTED") {
      if (e.metadata?.sameDevice === true) continue;
      const key = e.sessionRef ?? e.id;
      if (evictedRefs.has(key)) continue;
      evictedRefs.add(key);
      evictions += 1;
    } else if (e.type === "CONCURRENT_SESSION_DETECTED" && e.metadata?.mode === "detect") {
      evictions += num(e.metadata?.wouldEvict, 10);
    }
  }

  // Session starts in time order, by device.
  const starts = events.filter((e) => e.type === "SESSION_CREATED");
  const withDevice = starts.filter((e) => {
    if (e.deviceId) return true;
    quality.missingDevice += 1;
    return false;
  });
  const seq = (ms: number) => withDevice.filter((e) => within(e, now, ms)).map((e) => e.deviceId as string);

  const switchSeq = seq(t.switchWindowHours * HOUR);
  let switches = 0;
  for (let i = 1; i < switchSeq.length; i += 1) if (switchSeq[i] !== switchSeq[i - 1]) switches += 1;

  const ppSeq = seq(t.pingPongWindowHours * HOUR);
  let pingPongs = 0;
  for (let i = 2; i < ppSeq.length; i += 1) {
    if (ppSeq[i] === ppSeq[i - 2] && ppSeq[i] !== ppSeq[i - 1]) pingPongs += 1;
  }

  // Most distinct devices starting sessions inside any burst window.
  const burstMs = t.burstWindowMinutes * MIN;
  let burstDevices = 0;
  for (let j = 0; j < withDevice.length; j += 1) {
    const end = withDevice[j].occurredAt.getTime();
    const devices = new Set<string>();
    for (let i = j; i >= 0 && end - withDevice[i].occurredAt.getTime() < burstMs; i -= 1) {
      devices.add(withDevice[i].deviceId as string);
    }
    burstDevices = Math.max(burstDevices, devices.size);
  }

  const networkStarts = starts.filter((e) => within(e, now, t.networkWindowHours * HOUR));
  const networks = new Set(networkStarts.map((e) => e.ipHash).filter(Boolean)).size;

  // Countries only count when more than one device is involved.
  const geoStarts = withDevice.filter((e) => within(e, now, t.geoWindowHours * HOUR) && e.coarseGeo);
  const geoDevices = new Set(geoStarts.map((e) => e.deviceId)).size;
  const countries = geoDevices >= 2 ? new Set(geoStarts.map((e) => e.coarseGeo)).size : 0;

  const signals: RiskSignals = {
    evictions,
    switches,
    pingPongs,
    burstDevices,
    newDevices: count("DEVICE_REGISTERED", t.churnWindowDays * DAY),
    deniedDevices:
      count("DEVICE_REJECTED", t.deniedDeviceWindowDays * DAY) +
      count("DEVICE_EXPIRED", t.deniedDeviceWindowDays * DAY),
    limitReached: count("DEVICE_LIMIT_REACHED", t.limitWindowDays * DAY),
    mismatches: count("SESSION_DEVICE_MISMATCH", t.mismatchWindowHours * HOUR),
    loginFailures: count("LOGIN_FAILED", t.loginFailureWindowMinutes * MIN),
    networks,
    countries,
  };
  return { signals, quality };
}

function rulesetVersion(t: RiskThresholds): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ rules: RULES, cap: SUPPORTING_CAP, t: Object.entries(t).sort() }))
    .digest("hex")
    .slice(0, 10);
  return `${RULESET_VERSION_BASE}.${digest}`;
}

const RANK: Record<RiskTier, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export function tierRank(tier: RiskTier) {
  return RANK[tier];
}

export function evaluateRiskEvents(events: RiskEvent[], now: Date, t: RiskThresholds): RiskResult {
  const { signals, quality } = extractSignals(events, now, t);
  const measured: Record<RiskReasonCode, [number, number]> = {
    RAPID_SESSION_EVICTION: [signals.evictions, t.evictionCount],
    DEVICE_PING_PONG: [signals.pingPongs, t.pingPongCount],
    SESSION_DEVICE_MISMATCH: [signals.mismatches, t.mismatchCount],
    MULTI_DEVICE_BURST: [signals.burstDevices, t.burstDeviceCount],
    FREQUENT_DEVICE_SWITCHING: [signals.switches, t.switchCount],
    DEVICE_CHURN: [signals.newDevices, t.churnCount],
    REPEATED_DENIED_DEVICES: [signals.deniedDevices, t.deniedDeviceCount],
    LOGIN_FAILURE_BURST: [signals.loginFailures, t.loginFailureCount],
    DEVICE_LIMIT_PRESSURE: [signals.limitReached, t.limitCount],
    NETWORK_DISPERSION: [signals.networks, t.networkCount],
    GEO_DISPERSION: [signals.countries, t.geoCount],
  };

  const behavioral: Contribution[] = [];
  const supporting: Contribution[] = [];
  for (const rule of RULES) {
    const [value, threshold] = measured[rule.code];
    if (value < threshold) continue;
    const c: Contribution = { code: rule.code, weight: rule.weight, value, threshold };
    (rule.kind === "behavioral" ? behavioral : supporting).push(c);
  }

  // Supporting signals only count next to behavioural ones, and are capped.
  const contributions = [...behavioral];
  if (behavioral.length > 0) {
    let budget = SUPPORTING_CAP;
    for (const c of supporting) {
      const weight = Math.min(c.weight, budget);
      if (weight <= 0) break;
      contributions.push({ ...c, weight });
      budget -= weight;
    }
  }

  const score = contributions.reduce((sum, c) => sum + c.weight, 0);
  let tier: RiskTier =
    score >= t.criticalScore ? "CRITICAL" : score >= t.highScore ? "HIGH" : score >= t.mediumScore ? "MEDIUM" : "LOW";
  // Multi-signal caps: never restrict on one signal.
  const maxByCount: RiskTier = behavioral.length >= 3 ? "CRITICAL" : behavioral.length === 2 ? "HIGH" : "MEDIUM";
  if (RANK[tier] > RANK[maxByCount]) tier = maxByCount;

  const recommendedAction: RiskAction =
    tier === "CRITICAL"
      ? "REVIEW"
      : tier === "HIGH"
        ? "RESTRICT"
        : tier === "MEDIUM"
          ? "STEP_UP"
          : score > 0
            ? "ALLOW_LOG"
            : "ALLOW";

  const reasonCodes = contributions.map((c) => c.code);
  const version = rulesetVersion(t);
  const fingerprint = createHash("sha256")
    .update([version, tier, [...reasonCodes].sort().join(",")].join("|"))
    .digest("hex")
    .slice(0, 24);

  return {
    tier,
    score,
    reasonCodes,
    contributions,
    recommendedAction,
    signals,
    dataQuality: quality,
    rulesetVersion: version,
    fingerprint,
  };
}
