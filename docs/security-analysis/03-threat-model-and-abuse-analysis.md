# 03 — Account-Sharing Threat Model & Abuse Analysis (Phase 3)

> **Status:** Phase 3 (analysis only). No code, schema, auth, API, config, or deployment was modified. No database schema is designed here (that is Phase 4+).
> **Builds on:** `01-existing-system-analysis.md`, `02-auth-session-analysis.md`.
> **Purpose:** Understand how the *current* application could be abused for account sharing, and determine which signals actually exist versus which must be built.

---

## 0. Grounding facts (verified this phase)

Two facts constrain everything below and are worth stating up front because the brief assumes otherwise:

1. **There is no OTP.** Auth is email + password + a stateless JWT cookie. So every scenario framed as "share OTP" is really "share email + password" (and, if issued, "share an API key"). Documented as-is.
2. **The only network signal read at runtime is `x-forwarded-for` first-hop**, used solely for the in-memory login rate limiter (`src/app/api/auth/login/route.ts` line ~18). Verified by searching all of `src/`: there is **no** `cf-connecting-ip`, **no** `cf-ipcountry`, **no** user-agent capture, **no** geo/ASN lookup, **no** device cookie, and **no** persistence of any request metadata anywhere. Today the system stores *zero* signals that could distinguish one human from another on the same account.

Consequence: **the current system cannot detect account sharing at all.** There is no device identity, no session record, no login history, no audit log. Every "what signal exists?" answer in this phase is therefore mostly "none — must be built," and this phase's job is to specify *what to capture* so Phase 4+ can design the model.

---

## 1. Account-sharing scenarios

For each: **Today** (what actually happens) · **Signal exists** · **Signal missing** · **Future control**. "Legit?" marks whether the behavior is normal customer usage (must not be punished) or abuse.

### Scenario A — One customer: laptop + phone (Legit)
- **Today:** Both log in with the same password, each gets an independent 7/30-day JWT. Both work indefinitely and simultaneously. Nothing is recorded.
- **Signal exists:** none.
- **Signal missing:** device identity, session records, per-device last-seen.
- **Future control:** trusted-device model with a per-customer device limit (default ≥2–3 so this stays frictionless); count devices, not IPs.

### Scenario B — Home Wi-Fi / office Wi-Fi / mobile internet (Legit)
- **Today:** IP changes freely; irrelevant because IP is never persisted or checked (only the transient login rate-limit bucket keys on it).
- **Signal exists:** none persisted.
- **Signal missing:** stable device identity that survives network changes.
- **Future control:** anchor identity to a **server-issued device credential**, never to IP. IP change alone must contribute ~zero risk.

### Scenario C — "Shares OTP with family" → actually shares password (Abuse)
- **Today:** Recipients log in from their own devices; each gets a full-lifetime session. Undetectable and unlimited.
- **Signal exists:** none.
- **Signal missing:** device count, new-device events, concurrent sessions, login geography/velocity.
- **Future control:** device limit + new-device verification (needs a verification channel that does not exist yet — see Open Questions) + concurrency policy + risk scoring on new-device/geo-velocity.

### Scenario D — Account shared with one other person (Abuse, low intensity)
- **Today:** Two devices, two sessions, no limit, no record. Indistinguishable from Scenario A (a legit 2-device customer) **without more signals**.
- **Signal exists:** none.
- **Signal missing:** everything.
- **Future control:** this is the hardest case for false positives — a 2nd device is normal. Detection must rely on *combinations* (e.g. concurrent active use from distant locations, high device churn), not device count alone.

### Scenario E — Account shared with five people (Abuse, high intensity)
- **Today:** Five devices, five sessions, unlimited. Undetectable today, but the *most detectable* case once signals exist.
- **Signal exists:** none.
- **Signal missing:** device count, distinct concurrent sessions, geo spread.
- **Future control:** device-limit enforcement is the primary lever; risk engine escalates on many distinct devices + geographically dispersed concurrent sessions.

### Scenario F — Same account used simultaneously (Abuse signal, but also legit for A)
- **Today:** Fully allowed. No concurrency tracking (`02-…` §3). The target `maxConcurrentSessions=1` has no foundation.
- **Signal exists:** none.
- **Signal missing:** active-session set with last-activity timestamps.
- **Future control:** server-tracked sessions with a configurable concurrency policy. **Caveat (challenge to brief):** a hard `=1` will actively harm the legitimate laptop+phone customer in Scenario A. Recommend concurrency be **per-device-session** with a *simultaneous-distinct-device* threshold, or a soft "newest wins with notification," decided in Phase 4. Flagged, not decided here.

### Scenario G — Rapid device switching (Abuse signal)
- **Today:** No device identity, so "switching" is invisible.
- **Signal exists:** none.
- **Signal missing:** device-creation timestamps, session-creation cadence per account.
- **Future control:** rate of new-device registration + session creation per rolling window as a risk signal (not an auto-block).

### Scenario H — Large device churn (add/remove/replace) (Abuse signal)
- **Today:** No device model, so churn is invisible; also the natural evasion of any future device limit.
- **Signal exists:** none.
- **Signal missing:** device add/remove history with timestamps and actor.
- **Future control:** track churn; apply a **cool-down** on device-slot reuse (e.g. removing a device does not instantly free a slot) so a limit of 3 can't be cycled among 20 people. Balance against legit device replacement (Scenario L).

### Scenario I — Suspicious geographic changes / impossible travel (Abuse signal, weak alone)
- **Today:** No geo captured at all.
- **Signal exists:** none. (Cloudflare *can* supply `cf-ipcountry`/`cf-connecting-ip` at the edge, but the app does not read them and the proxy config is unconfirmed.)
- **Signal missing:** per-login approximate country/region + timestamp to compute travel velocity.
- **Future control:** capture coarse geo (country/region) from a trusted proxy header; use **impossible travel** (two active sessions in distant places within an implausible interval) as a strong *combined* signal. Never block on country change alone.

### Scenario J — Attacker steals a session token (Security threat)
- **Today:** Cookie is `httpOnly` (blunts XSS exfiltration) but the JWT is non-revocable, replayable for up to 30 days, and **not bound to device/IP/UA** (`02-…` T1/T4). A stolen cookie works anywhere until expiry.
- **Signal exists:** none; no way to detect or kill the stolen session.
- **Signal missing:** server session record, device binding, revocation.
- **Future control:** server-tracked sessions bound to a device credential + revocation + anomaly detection (same session id suddenly on a new device/geo).

### Scenario K — Attacker directly calls APIs (Security threat)
- **Today:** All routes require the JWT cookie or an API key (middleware + `requireUser`/`requireAdmin`), so direct calls need a valid credential — good. **But** the gold/silver/fx update routes let *any* authenticated USER mutate **all tenants'**/global data (BFLA, `02-…` B1), and `ocr/process` / `settings PUT` do work before the auth check (`02-…` B4).
- **Signal exists:** partial (auth is enforced); no per-endpoint authorization beyond role.
- **Signal missing:** function-level authorization on shared-state routes; audit of privileged calls.
- **Future control:** restrict shared-state mutation to admin/cron only; move auth before body parsing; audit privileged calls. (Independent of account sharing, but in the same code.)

### Scenario L — Legitimate customer changes/reinstalls device or clears cookies (Legit — false-positive risk)
- **Today:** They just log in again with the password; a new JWT is issued; no friction, nothing recorded.
- **Signal exists:** none.
- **Signal missing:** a way to tell "same person, new device" from "another person, new device."
- **Future control:** device recovery UX (verification step to re-enroll), self-service device removal, and admin override. This scenario is *why* device limits must be recoverable and generous, and why cookie-clearing must degrade gracefully (a new device credential is issued and counted, with verification rather than a hard lockout).

---

## 2. IP address analysis

- **What IP is today:** a transient key for the in-memory login rate limiter only (`x-forwarded-for` first hop). Not stored, not linked to a user, not checked for authorization.
- **Why IP must NOT be identity:** a single legitimate customer traverses home/office/mobile/CGNAT within a day; conversely many distinct sharers can share one office/NAT IP. IP correlates poorly with humans in both directions.
- **`x-forwarded-for` is spoofable** unless the app trusts only a known proxy. With Cloudflare in front, the reliable value is `cf-connecting-ip`; there is **no committed proxy/trust configuration**, so today the first-hop XFF could be attacker-controlled. Any future use must read a proxy-validated header and reject/normalize untrusted hops.
- **Appropriate use (as a *risk signal* only):** derive coarse geo/ASN and network-type from a trusted IP for: impossible-travel detection (combined with time), datacenter/hosting-ASN indicators (a sign of scripted/proxy access), and *change-of-network* as a minor input. Always low-weight, always combined, never a standalone block.
- **Privacy:** store IP hashed/truncated where full precision isn't needed; retain only for a bounded window; treat as personal data.

---

## 3. Device signals — availability and limitations

The product is a **browser-only web app** (no native client, no reliable hardware id). Options:

| Signal | Availability | Reliability / limitation | Recommended role |
|---|---|---|---|
| **Server-issued device id** (random opaque token in an httpOnly cookie, distinct from the session) | Must be built | High as a *bearer credential*; not tamper-proof identity — cleared cookies/new browser = new device (counts as new, needs verification) | **Primary device anchor.** Cryptographically random (CSPRNG), stored server-side, bound to sessions. |
| Secure random device identifier | Must be built | Same as above; strength is unguessability, not immutability | Same as primary; **do not** derive from client-controllable data |
| User-agent (browser/OS/platform) | Read from request (not captured today) | Trivially spoofable; changes on browser update | Low-weight *descriptive* metadata + weak change signal; never authoritative |
| Cookies (device credential storage) | Available | httpOnly + secure needed; cleared by user; blocked in some privacy modes | Storage mechanism for the device id |
| localStorage | Available | JS-accessible (XSS-exposed), cleared easily, not sent automatically | **Avoid** for security credentials |
| Browser fingerprinting (canvas/font/etc.) | Would need a library | Unstable across updates, privacy-invasive, defeated by hardened browsers, high false-match/false-split rates | **Reject as identity.** At most a *very* low-weight corroborating signal later; not in V1 |

**Design stance (challenge to brief):** treat the device as a **server-issued bearer credential**, not a fingerprint. Fingerprinting is explicitly rejected as an identity mechanism for reliability and privacy reasons. Cleared-cookie / reinstall / new-browser all correctly produce a *new device* that is *counted* and *verified*, not silently trusted and not hard-blocked.

---

## 4. Session signals (all must be built — none exist today)

| Signal | Why useful | Currently |
|---|---|---|
| Simultaneous active sessions (distinct devices) | Core sharing indicator | Not tracked |
| Session switching (same session id appearing on new device/geo) | Token theft / hand-off | Not tracked |
| Session creation frequency per account | Churn / scripted logins | Not tracked |
| Session duration / last-activity | Idle vs active; concurrency needs "active" definition | Not tracked |
| Session revocation events | Force-logout, admin action, anomaly response | Impossible (no revocation) |

These require the server-side session record identified as the load-bearing change in `02-…` §9.

---

## 5. Authentication signals

Because there is no OTP, the relevant auth signals are password/API-key/login based:

| Signal | Availability | Notes |
|---|---|---|
| OTP request / failed / success / resend frequency | **N/A** | No OTP exists |
| Login frequency per account | Not captured (login isn't logged) | Build login-attempt logging (success + failure) |
| Failed password attempts per account | Not captured (only IP bucket, in-memory, not persisted) | Build per-account failure tracking → lockout/step-up |
| New-device login events | Not captured | Depends on device model |
| API-key issuance/use/revoke | `lastUsedAt` only | No audit of who/where |

If a verification channel (OTP/email) is later introduced for device enrollment, OTP-frequency/failure signals become available and should be captured then.

---

## 6. False-positive analysis

Behaviors that are **legitimate** but could look suspicious, and the principles that protect them:

- **Multiple devices (laptop + phone + tablet):** normal → device limit default must be generous (≥2–3), not 1.
- **Frequent network changes (home/office/mobile):** normal → IP/network change must be near-zero weight.
- **Travel across cities/countries:** normal → geo change alone is not abuse; only *impossible travel between concurrently-active sessions* counts, and even then prefer verification over block.
- **Device replacement / OS reinstall / cookie clearing:** normal → new device must be recoverable via verification + self-service/admin, never a hard lockout; apply grace, not churn penalties, for infrequent replacement.
- **Browser updates changing UA:** normal → UA is descriptive only.
- **Shared office NAT (same IP, several legit staff on separate licenses):** normal → never treat shared IP as one identity or as collusion.
- **Back-to-back logins after "remember me" lapse:** normal → don't flag routine re-auth.

**Principles:** (1) prefer *verification/step-up* over restriction; (2) require *multiple corroborating* signals for any restriction; (3) make restrictions *temporary, explainable, reversible, admin-visible*; (4) default thresholds to protect the honest multi-device customer; (5) provide user-facing recovery for every automated action.

---

## 7. Threat model

| Threat | Impact | Current protection | Gap | Future control |
|---|---|---|---|---|
| **Credential sharing (email+password)** | Revenue loss on lifetime license; unlimited seats | None | No device/session/concurrency tracking | Device limit + new-device verification + concurrency policy + risk scoring |
| **"OTP" sharing (→ password/API-key sharing)** | Same as above | None | No OTP exists; API keys have no per-use audit | Verification channel; API-key limits/audit; device binding |
| **Device abuse (many devices)** | Many concurrent users on one license | None | No device model | Enforced per-customer device limit; churn cool-down |
| **Session abuse (many concurrent sessions)** | Multiple simultaneous users | None | No session store, no limit | Server-tracked sessions + configurable concurrency |
| **Token theft (stolen cookie)** | Full account takeover for ≤30 days | httpOnly cookie only | Non-revocable, unbound, replayable JWT | Server sessions + device binding + revocation + anomaly detection |
| **Direct API calls / API bypass** | Data access without UI | Auth enforced on all routes | **BFLA:** any USER mutates all-tenant/global state; auth-after-parse | Function-level authZ (admin/cron only); auth before work; audit |
| **Device spoofing (forged device id/UA)** | Evade device limit | None | UA trivially spoofed; no device credential | Server-issued unguessable device credential; ignore client-asserted ids |
| **Race conditions (concurrent logins bypass limit)** | Exceed concurrency/device caps under parallel requests | None | In-memory checks, no atomicity | Atomic DB ops / unique constraints / transactions (Atlas replica set) — Phase 4 |
| **Admin compromise** | Full control; disable/delete/keys; non-revocable admin token | Password + role gate | No MFA/step-up, no audit, non-revocable JWT, seed fallback creds | Admin MFA/step-up, audit trail, revocable admin sessions, remove seed fallbacks |
| **False positives (legit user restricted)** | Churn, support load, reputational harm | N/A (no detection yet) | Risk of over-blocking once detection exists | Multi-signal + verification-first + reversible/time-bound restrictions + recovery UX |

---

## 8. Abuse-detection requirements (what the future system must *detect* — not how)

Risk **tiers** and their intended meaning (thresholds and scoring are Phase 4+ work):

- **LOW — allow, log only.** Normal usage: known device, within device/concurrency limits, ordinary network/geo variation, routine re-auth. No user-visible friction. Purpose: build a behavioral baseline and audit trail.
- **MEDIUM — allow with step-up / verification.** Mild anomaly: a *new* device within the limit; login from a new coarse region; moderate session-creation cadence. Response: verify the device (verification channel) or notify; **do not** restrict access. Must tolerate legit multi-device / travel.
- **HIGH — soft restriction + verification, admin-visible.** Strong combined signals: device limit exceeded; several distinct concurrent sessions; impossible travel between active sessions; rapid device churn. Response: temporary, reversible restriction (e.g. require re-verification, hold new sessions) + surface to admin. Never permanent, always explainable.
- **CRITICAL — hard temporary restriction + mandatory admin review.** Egregious/clearly-abusive or security-incident patterns: many distinct devices + dispersed concurrent sessions; credential-stuffing-style failure bursts; a session id jumping devices/geographies (token theft). Response: suspend the affected sessions, require admin review to restore. Still reversible; audited.

**Cross-cutting requirements the detector must satisfy:** deterministic and explainable (each decision cites the signals that triggered it); multi-signal (never a single-signal block, and never IP/geo alone); auditable (every evaluation and action logged with reason); privacy-bounded (store the minimum, hash/truncate where possible, bounded retention); reversible (all restrictions time-bound or admin-clearable); fail-safe (if the detector is unavailable, prefer *allow + log* for legitimate access rather than locking out paying customers — exact fail-open/closed matrix is a Phase 4 decision).

**Detection is deferred to a deterministic rules engine first; ML is a possible future enhancement, not a V1 requirement.**

---

## 9. Signal inventory summary (build-list for Phase 4)

Signals that must be **captured/persisted** before any detection is possible (none exist today):

1. Server-issued **device credential** + device record (first/last seen, status).
2. Server-side **session records** (device id, created, last-activity, status, revocation).
3. **Login events** (success/failure, timestamp, account, coarse network/geo, device).
4. **Coarse geo/network** derived from a *trusted* proxy IP header (country/region/ASN/network-type), stored minimally.
5. **Device add/remove/churn** history.
6. **Admin/security audit events**.

---

## 10. Open questions (carried / new)

1. **Verification channel** for new-device enrollment / step-up still does not exist (no OTP, no email provider). Blocks MEDIUM/HIGH responses. (Carried from Phase 1/2.)
2. **Concurrency policy vs. legitimate multi-device use:** hard `=1` conflicts with Scenario A. Decide the policy shape (per-device sessions + simultaneous-distinct-device threshold, or newest-wins-with-notify) in Phase 4.
3. **Trusted proxy configuration:** is Cloudflare guaranteed in front, and can we rely on `cf-connecting-ip`/`cf-ipcountry`? Needed before IP/geo signals are trustworthy.
4. **Geo/ASN provider:** Cloudflare headers vs. MaxMind vs. none — affects privacy posture and impossible-travel accuracy.
5. **Device-limit defaults and churn cool-down values** — to be set with the business (must protect honest multi-device customers).
6. **Scope of the BFLA cross-tenant write routes (B1):** fix within this project or track separately.

---

PHASE 3 COMPLETE — WAITING FOR PHASE 4.
