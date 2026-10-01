# 04 — Target Enterprise Security Architecture (Phase 4)

> **Status:** Phase 4 (design only). No code, schema, auth, API, config, or deployment was modified. No migrations, no packages.
> **Builds on:** `security-analysis/01-existing-system-analysis.md`, `02-auth-session-analysis.md`, `03-threat-model-and-abuse-analysis.md`.
> **Stack constraints carried forward:** Next.js 16 App Router · React 19 · TypeScript · **MongoDB Atlas (replica set, transactions available)** via the raw `mongodb` driver at runtime (Prisma = schema/seed only) · stateless HS256 JWT cookie today · single-instance PM2 fork behind Cloudflare (plain HTTP origin) · **no OTP, no email provider, no device/session/license/audit models exist today.**

---

## 0. Guiding decisions (and where we challenge the brief)

The brief's flow is `Customer → License → Email OTP → Trusted Devices → Session Control → Risk → Restriction → Admin`. We adopt it with **four deliberate deviations**, each justified from the prior analysis:

1. **Keep password login; add email OTP only as step-up / device verification — not as the primary factor.** No OTP or email provider exists (`02-…` §1). Rebuilding primary auth around OTP is a large, risky change to a live product for little sharing-prevention gain (OTP is as shareable as a password — `03-…` Scenario C). Password stays primary; OTP becomes the **new-device verification and step-up** channel. This requires introducing an email provider (open question, but now scoped to a narrow purpose).
2. **Move from stateless JWT to server-tracked sessions** — the single load-bearing change. Every target capability (revoke, force-logout, suspend, concurrency limit, device binding) is impossible with today's non-revocable JWT (`02-…` T1/S1). We keep a JWT as the *transport* but make it carry a server-validated `sessionId`.
3. **Reject browser fingerprinting as identity; use a server-issued device credential.** Fingerprinting is unreliable and privacy-invasive (`03-…` §3). A device is an unguessable server-minted secret in an httpOnly cookie.
4. **Do not enforce a hard `maxConcurrentSessions = 1` in a way that punishes the honest laptop+phone customer.** Concurrency is enforced **per active session across distinct devices**, with the limit *configurable* and a *policy* (deny / newest-wins / step-up) rather than a blunt global `1`. Default recommendation and rationale in §6.

**Non-goal:** making sharing impossible. Goal (per mission): make it difficult, detectable, auditable, rate-limited, reversible, and hard to scale — without friction for legitimate multi-device use.

---

## 1. Architecture overview

```
                         ┌─────────────────────────── Cloudflare (TLS, trusted proxy) ───────────────────────────┐
Browser / API client ───▶│  cf-connecting-ip, cf-ipcountry (trusted headers)                                     │
                         └───────────────────────────────────────────────┬────────────────────────────────────┘
                                                                          ▼
                                        ┌───────────────── Next.js Edge Middleware ─────────────────┐
                                        │ 1. Verify session JWT (sig + exp)  → sessionId, deviceId   │
                                        │ 2. Lightweight gate (role, obvious 401/403)                │
                                        │    (NO DB call here — edge stays fast)                     │
                                        └───────────────────────────────┬───────────────────────────┘
                                                                         ▼
                        ┌──────────────── Access Decision Layer (Node runtime, per protected request) ───────────┐
                        │  authorize(ctx) → single choke point, called by requireUser/requireAdmin wrappers       │
                        │  ┌───────────┬───────────┬───────────┬───────────┬───────────┬──────────────────────┐  │
                        │  │  AuthN    │  License  │  Device   │  Session  │  Restriction │  Risk (async-first) │  │
                        │  │  (who)    │ (entitled)│ (trusted) │ (valid,   │  (account    │  (signals→score)    │  │
                        │  │           │           │           │  active)  │   status)    │                     │  │
                        │  └───────────┴───────────┴───────────┴───────────┴───────────┴──────────────────────┘  │
                        └───────────────────────────────┬───────────────────────────────────────────────────────┘
                                                         ▼
                                        Route handlers → Services (userId from server ctx) → MongoDB Atlas
                                                         │
                                                         ├── Security collections: Session, Device, License,
                                                         │   SecurityEvent, AccountRestriction, RiskAssessment, AdminAction
                                                         └── Async risk worker (in-process scheduler / event queue) reads
                                                             SecurityEvent, writes RiskAssessment + AccountRestriction
```

**Two-tier enforcement:** the edge middleware does only cheap, stateless checks (signature/expiry/role) so static and page loads stay fast; **authoritative checks that need the DB** (session validity, device trust, restriction status, license) run in the Node runtime via a single **Access Decision Layer** invoked by `requireUser()`/`requireAdmin()`. This matches the existing two-layer pattern (`middleware.ts` + `session.ts` guards) rather than replacing it.

---

## 2. Component architecture (modular monolith — no microservices)

All components live in the existing app as `src/lib/security/*` modules and Mongo collections. No new services, no Redis, no queue infrastructure (justified in §15). Responsibilities:

| Component | Module (proposed) | Responsibility |
|---|---|---|
| **Auth** | `security/auth` (extends `lib/auth`) | Password login (unchanged), issue session-bound JWT, OTP step-up for new devices |
| **License** | `security/license` | Entitlement check: is this customer currently allowed to use the product |
| **Device** | `security/device` | Mint/verify device credentials, enforce device limit, churn cool-down, revoke/recover |
| **Session** | `security/session` | Create/validate/revoke server sessions, concurrency enforcement (atomic) |
| **Risk** | `security/risk` | Deterministic rules over signals → score/tier → recommended action (explainable) |
| **Restriction** | `security/restriction` | Apply/lift reversible account restrictions; source + reason + expiry |
| **Security events** | `security/events` | Append-only writer for all security-relevant events |
| **Audit** | `security/audit` | Admin-action trail (who/what/when/why); subset of events, immutable |
| **Admin security** | `security/admin` + API + UI | Read models + privileged actions (revoke, suspend, restore, set limits) |
| **Access Decision** | `security/access` | The single `authorize(ctx)` choke point composing all of the above |

**Reuse, don't rebuild:** password hashing, API keys, and existing route guards remain; we wrap `requireUser`/`requireAdmin` so every route gains device/session/restriction checks with minimal edits.

---

## 3. Authentication architecture

```
Email + Password ──▶ bcrypt verify ──▶ isActive + License + Restriction check
                                             │
                          ┌──────────────────┴───────────────────┐
                          ▼                                       ▼
                 Known trusted device                    New / unrecognized device
                 (device cookie matches                  (no/unknown device cookie)
                  a trusted Device row)                          │
                          │                                      ▼
                          ▼                             Device-limit check
                 Create session (concurrency      ┌───── slot available ─────┬──── limit reached ────┐
                 policy applied) → JWT(sessionId)  ▼                          ▼                        ▼
                                            Email OTP step-up        Require device removal    (config) allow-with-review
                                            (verify → register       or admin action           + HIGH risk event
                                             device as trusted)
```

- **Primary factor stays password** (`02-…`), preserving the live flow and admin-created accounts.
- **Email OTP is a *step-up* factor** used only for **new-device registration** and high-risk step-up. Scoped, so the email provider is a small addition, not a rewrite.
- **OTP properties (when built):** 6-digit, CSPRNG, hashed at rest, short TTL (e.g. 5–10 min), max attempts + resend rate limit, single-use, per-account + per-IP rate limited. (Concrete values in Phase 5/data design.)
- **API keys** unchanged for machine access, but gain per-use audit events and are treated as their own "device class" (not counted against the human device limit).

---

## 4. Authorization architecture — the Access Decision Layer

The core anti-scatter mechanism (`brief §33`). A single function composes all checks and is the *only* place authorization logic lives:

```
authorize(ctx): Decision
  ctx = { user, role, sessionId, deviceId, ip(trusted), coarseGeo, route, method }

  1. AuthN      : session valid?                         else 401
  2. Role       : role permitted for route?              else 403
  3. Restriction: account status ALLOWs this action?     else 403 (restricted/suspended/revoked)
  4. License    : entitled to product?                   else 403 (no/again revoked license)
  5. Device     : device trusted (or verification path)? else → verify / 403
  6. Session     : session active & not revoked & within concurrency? else 401 (re-auth)
  7. Risk       : attach riskContext (non-blocking read of latest assessment; may downgrade to step-up)
  → Decision: ALLOW | ALLOW+LOG | STEP_UP | RESTRICT | DENY   (always with reason codes)
```

- Wrapped by `requireUser()`/`requireAdmin()` so existing routes adopt it with a one-line change.
- **Consults current DB state**, fixing `02-…` T2/A1/A3 (disable/suspend now takes effect immediately).
- **Explainable:** every decision returns reason codes, written to `SecurityEvent`.
- **Fail-safe posture** per check defined in §14.

---

## 5. Device architecture

**Model:** `User (1) ──< Device (1) ──< Session`.

- **Identity = server-issued unguessable credential.** On first contact from an unknown browser, the server mints `deviceSecret` (CSPRNG) → stores `hash(deviceSecret)` in a `Device` row → sets an httpOnly, secure, long-lived `atelier_device` cookie (separate from the session cookie). The client never sees the raw secret again after set; the server validates by hashing the presented cookie. **No fingerprinting.**
- **Trust states:** `PENDING_VERIFICATION` → `TRUSTED` → (`REVOKED` | `EXPIRED`). Only `TRUSTED` devices can hold active sessions.
- **Configurable device limit** per customer (`License.deviceLimit`, default e.g. 3). Enforced atomically when a device transitions to `TRUSTED` (§6 concurrency technique).
- **New-device verification:** slot available → email OTP → mark `TRUSTED`. Slot full → user must remove a device (self-service) or contact admin; attempt logged as a signal (not an auto-block).
- **Device replacement / recovery (legit — `03-…` Scenario L):** self-service "remove device" frees a slot **after a churn cool-down** (so a 3-slot license can't be cycled among many people); admin can always free slots and re-verify. Cookie cleared / reinstall / new browser ⇒ a *new* `PENDING` device that goes through verification — graceful, never a hard lockout.
- **Churn control:** `Device` add/remove history + cool-down window on slot reuse; rapid churn raises risk (`03-…` Scenario H) without blocking a single legitimate replacement.
- **Privacy:** store coarse descriptors only (platform/browser family, first/last seen, last coarse geo, hashed/truncated last IP). No fingerprint hashes.

---

## 6. Session architecture & concurrency (race-safe)

**Model:** server-tracked `Session` rows. The cookie is a JWT that carries `sessionId` + `deviceId`; **validity is authoritative from the DB**, not the JWT alone.

- **Create:** on successful auth from a `TRUSTED` device → insert `Session{ userId, deviceId, status:ACTIVE, createdAt, lastActivityAt, expiresAt }`; issue JWT with `sessionId`.
- **Validate (per protected request, Node runtime):** JWT sig/exp (edge) **and** `Session.status===ACTIVE && not expired && not revoked` (Access Decision). Update `lastActivityAt` throttled (e.g. at most every N seconds) to avoid write amplification.
- **Revoke / force-logout / suspend:** flip `Session.status = REVOKED`. Effective on the *next* request immediately — the capability that is impossible today.
- **Logout:** now truly revokes the server session (fixes `02-…` S3).

**Concurrency policy (challenging the blunt `=1`):**
- Config: `License.maxConcurrentSessions` (default configurable) and `concurrencyPolicy ∈ { DENY_NEW, NEWEST_WINS, STEP_UP }`.
- **APPROVED default (Biz-A, doc 07 Addendum A):** `maxConcurrentSessions = 1`, `deviceLimit = 3`, `evictionPolicy = NEWEST_WINS`. A customer may keep up to 3 trusted devices but only 1 active session at a time; a new login evicts the prior active session. Values live in `License` + one config module and are **not** hard-coded.
- **UX note (accepted):** at `=1`, switching between the customer's own devices requires a fresh login each time (the prior session is evicted). This is a conscious trade-off; the rapid-eviction risk signal (ADR-018) distinguishes occasional legit switching from frequent contention (two people / attacker).

**Race-condition safety (`brief §13`, Atlas replica set):**
- Enforce the concurrency/device caps with **atomic MongoDB operations**, not read-then-write:
  - Device-slot claim and session-count enforcement use a **multi-document transaction** (Atlas supports it) or a **conditional atomic update** (`findOneAndUpdate` guarded by a version/count field) so two parallel logins cannot both observe "0 active" and both create a session.
  - **Unique indexes** provide a hard backstop (e.g. a partial unique index on active session per device, or a session-slot document per license). A losing racer gets a duplicate-key error and retries/deny — deterministic, no lock service.
- **No Redis / no external lock manager** — the DB's atomicity is sufficient at the expected scale (§15). Optimistic concurrency (version field) is the default; a short-lived DB-backed lock document is the fallback only if a specific op proves contended.

---

## 7. Risk architecture (deterministic, explainable, async-first)

```
Signals ─▶ Risk Rules (pure, versioned) ─▶ Score/Tier ─▶ Recommended Action ─▶ Audit
```

- **Signals (from `03-…` §9, all newly captured):** new-device event, device count vs limit, device churn rate, concurrent distinct-device sessions, session-creation cadence, login success/failure bursts, coarse geo change, impossible travel between *active* sessions, datacenter/hosting ASN, OTP failure/resend rate (once OTP exists). **IP is a low-weight signal, never identity.**
- **Engine:** a **deterministic weighted-rules** evaluator (not ML in V1 — `03-…` §8). Each rule is a pure function `(signals) → { contribution, reasonCode }`; the sum maps to a tier via configurable thresholds. Rules and weights are **config/versioned**, so tuning never requires touching auth code.
- **Explainability:** every evaluation stores the contributing reason codes in `RiskAssessment` → visible to admin.
- **Execution model:** **async-first.** Login/session creation performs only cheap synchronous checks (device limit, concurrency, restriction). Heavier correlation (impossible travel, churn windows) runs in a **background evaluation** (the existing in-process scheduler pattern from `instrumentation.ts`, or an event-driven consumer of `SecurityEvent`), writing `RiskAssessment` and, if warranted, an `AccountRestriction`. This keeps the request path fast and scalable (`brief §14`).
- **Actions:** `ALLOW+LOG` (LOW) · `STEP_UP` (MEDIUM) · soft `RESTRICT` + admin-visible (HIGH) · hard temporary restrict + mandatory review (CRITICAL). Never IP/geo alone; always multi-signal (`03-…` §6/§8).

---

## 8. Restriction architecture (reversible, auditable)

**Chosen status model** (evaluated alternatives in §17). Account status is a small, explicit enum on the account/license, and *active restrictions* are separate time-bound rows so history is preserved:

```
Account status:  ACTIVE ──▶ REVIEW_REQUIRED ──▶ TEMPORARILY_RESTRICTED ──▶ SUSPENDED ──▶ REVOKED
                    ▲             │                      │                    │
                    └──── admin restore / expiry ────────┴────────────────────┘   (REVOKED = terminal, admin-only)
```

- **ACTIVE** — normal.
- **REVIEW_REQUIRED** — flagged for admin attention; access continues (soft) or with step-up, per severity. No hard block.
- **TEMPORARILY_RESTRICTED** — automated, **time-bound**, reversible; e.g. new sessions held / step-up required. Auto-expires unless escalated.
- **SUSPENDED** — stronger hold; access blocked until admin or verification clears it.
- **REVOKED** — terminal license removal; **admin-only**, never automated. (This is the "lifetime access removed by admin" case from the mission.)

`AccountRestriction` row = `{ reason, source (RISK_ENGINE|ADMIN), severity, status, createdAt, expiresAt?, createdBy, metadata }`. Restrictions are **append-only with lift events** (never hard-deleted) so the audit trail is intact. **Automated actions are always reversible and default to the least-severe effective option**; only an admin can `SUSPEND`/`REVOKE` for good or clear anything. Removal of a restriction is itself an audited `AdminAction`.

---

## 9. Admin security center architecture

New admin surface under `/admin/security` (server-authorized with its own `requireAdmin()` — fixing `02-…` H3, not relying on middleware alone). Read models + privileged actions:

- **View:** per-customer security status, license/entitlement, device list (platform/browser/first-seen/last-seen/coarse geo/status), active sessions, risk assessments (with reason codes), restrictions (with reasons/expiry), audit trail.
- **Act (all audited):** revoke a device · revoke a session · force logout (all sessions) · remove/adjust a restriction · suspend/restore access · revoke license · set device limit · set concurrency limit/policy · add internal note · controlled override.
- **Admin hardening (`brief §27`):** step-up (re-auth or OTP) required for high-impact actions (revoke license, suspend, override); admin sessions are server-tracked and revocable like everyone's; recommend admin MFA; remove seed fallback credentials (`01-…` M5). No security override without an `AdminAction` audit row.

---

## 10. Audit & security-event architecture

- **`SecurityEvent`** — append-only, high-volume, the raw signal + decision log (`LOGIN_SUCCESS/FAILED`, `DEVICE_REGISTERED/VERIFIED/REVOKED`, `SESSION_CREATED/REVOKED`, `CONCURRENT_SESSION_DETECTED`, `RISK_EVALUATED`, `RESTRICTION_*`, `ADMIN_*`, `LICENSE_*`). Metadata: `eventId, occurredAt, userId?, deviceId?, sessionId?, type, actorType, actorId, ip(trunc/hashed), coarseGeo, reasonCodes, requestId, metadata`. **Time-bounded retention** (e.g. 90–180 days for raw events) to control growth and honor privacy.
- **`AdminAction`** — the immutable subset covering privileged admin operations; longer retention; never editable/deletable through the app.
- **Immutability:** enforced by write-only access patterns (no update/delete code paths for these collections) and, where supported, TTL only for expiry of raw events — admin audit is exempt from TTL.
- **Minimal PII:** store hashed/truncated IP, coarse geo only, no fingerprints, no message bodies.

---

## 11. Security boundaries

- **Edge (middleware):** cheap, stateless authenticity + role routing. Cannot be the sole authority for stateful checks.
- **Node runtime (Access Decision):** authoritative authorization; the only place stateful security decisions are made. **All mutations go through services that receive identity from server context, never from request input** (preserves the current no-IDOR property, `02-…` B2).
- **Data layer:** security collections separate from domain data; privileged writes (restrictions, license, admin actions) only reachable via admin-authorized paths.
- **Fix in-scope authorization defect:** the cross-tenant/global rate-update routes (`02-…` B1) restricted to admin/cron only — folded into this boundary work.

## 12. Trust boundaries

```
Untrusted: browser input, cookies' raw values, x-forwarded-for from unknown hops, user-agent
Trusted-if-configured: Cloudflare cf-connecting-ip / cf-ipcountry (ONLY if origin is locked to Cloudflare)
Trusted: server-side Session/Device/License/Restriction state in Mongo; SESSION_SECRET; device secret hashes
```

Key rule: **the device cookie and session JWT are bearer tokens — trusted only after server validation against DB state.** IP/geo headers are trusted **only** once the origin is provably fronted by Cloudflare (open question #3 from Phase 3); until then they stay near-zero weight.

---

## 13. Data flows

**New-device login (happy path):**
```
password ok → device cookie unknown → device-limit slot free → issue OTP (email) →
user enters OTP → Device=TRUSTED → create Session (concurrency ok) → JWT(sessionId) → SecurityEvents logged
```
**Returning trusted device:**
```
password ok (or valid session) → device TRUSTED → restriction/license ok → concurrency check (atomic) →
create/continue Session → ALLOW → LOGIN_SUCCESS event
```
**Risk escalation (async):**
```
events stream → background risk eval → RiskAssessment(reasons) → if HIGH/CRITICAL → AccountRestriction →
Access Decision enforces on next request → admin sees it in Security Center
```
**Admin restore:**
```
admin (step-up) → clear restriction → AdminAction audit → Access Decision allows next request
```

---

## 14. Failure modes (fail-open vs fail-closed matrix)

Per `brief §29`, chosen to avoid locking out paying customers while protecting privileged surfaces:

| Dependency down | Behavior | Rationale |
|---|---|---|
| **DB (Atlas) unavailable** | AuthN/session validation **fail-closed** (can't verify → deny); but surface a clear retry, don't destroy sessions | Can't safely authorize without state; matches current 503-on-DB-error login behavior |
| **Email/OTP provider down** | New-device verification **fails gracefully**: block *new-device registration* only; **do not** block already-trusted devices | Legit users on known devices keep working; only enrollment pauses |
| **Risk engine/worker down** | **Fail-open + log**: allow normal access, queue events for later evaluation | Risk is advisory/async; must not gate the request path |
| **Restriction store unreadable** | **Fail-closed for privileged/admin actions**, fail-open+log for ordinary reads | Protect high-impact ops; keep product usable |
| **Clock skew** | Rely on server time for expiry/impossible-travel; tolerate small skew windows | JWT exp + session exp both server-issued |
| **Concurrency txn fails/contended** | Deny the *new* session with retry, keep existing sessions | Never violate the cap; never kill a good session on error |

---

## 15. Scalability

- **Request path stays cheap:** edge does no DB work; Access Decision does a small number of indexed lookups (session by id, device by hash, restriction by userId) — all O(1) with proper indexes (Phase 5 designs them). `lastActivityAt` writes are throttled.
- **Heavy correlation is async** (background worker), so per-request cost is bounded from 10 → 100k+ users.
- **No new infrastructure:** MongoDB Atlas transactions/atomic ops cover concurrency; the existing in-process scheduler pattern covers async risk eval. **Redis, queues, and microservices are explicitly not introduced** (justified: single primary datastore, modest scale, atomicity available in Mongo — adding them now is complexity without payoff, `brief §14/§47`).
- **Horizontal-scale readiness:** because session/rate/concurrency state moves to the DB, the app becomes safe to run multi-instance later (fixing `01-…` H2). In-memory rate limiting is replaced by DB-backed counters. **This must be done before any `pm2 -i`/multi-node deployment.**

---

## 16. Security principles applied

Server-side enforcement (Access Decision) · defense-in-depth (edge + runtime + DB constraints) · least privilege (admin step-up, function-level authZ) · secure-by-default (new devices untrusted; restrictions reversible-by-default) · explicit authorization (every request authorized against user+license+device+session+status+risk) · auditability (append-only events + admin actions) · reversibility (time-bound restrictions) · privacy (minimal, hashed/coarse signals) · reliability (explicit fail matrix) · testability (pure risk rules, single choke point).

---

## 17. Alternatives considered

| Decision | Chosen | Alternatives rejected & why |
|---|---|---|
| Session model | JWT-carrying-`sessionId` validated vs DB | (a) Pure opaque session token — viable, but requires a DB read at the edge or a bigger middleware rewrite; JWT+sessionId lets edge stay stateless and Node validate statefully. (b) Keep pure stateless JWT — cannot revoke; rejected. |
| Device identity | Server-issued random cookie credential | Browser fingerprinting — unreliable + privacy-invasive (`03-…` §3), rejected as identity. mTLS/client certs — infeasible for consumer web. |
| Concurrency | Configurable limit + policy (default NEWEST_WINS/step-up) | Hard global `=1` DENY — punishes laptop+phone customers; offered as a config option, not the default. |
| Risk engine | Deterministic versioned rules, async | ML-first — not explainable/auditable in V1; deferred to future enhancement. Synchronous heavy scoring — hurts latency/scale. |
| Concurrency safety | Mongo transactions / atomic conditional updates + unique indexes | Redis/Redlock or external lock service — unnecessary infra at this scale; Mongo atomicity suffices. |
| Verification channel | Email OTP as *step-up only* | OTP as primary factor — large rewrite of live auth, no anti-sharing benefit (OTP is shareable). |
| Deployment topology | Make state DB-backed now; stay single-instance until ready | Introduce clustering immediately — premature; but design removes the in-memory blockers. |

## 18. Architecture decisions (ADR index — full ADRs to accompany Phase 5)

- **ADR-001 Device identity:** server-issued random cookie credential; no fingerprinting.
- **ADR-002 Session model:** server-tracked sessions; JWT carries `sessionId`; DB is authoritative.
- **ADR-003 Concurrent-session enforcement:** configurable limit + policy; atomic DB enforcement; default protects multi-device.
- **ADR-004 Risk evaluation:** deterministic versioned rules, async-first, explainable; ML deferred.
- **ADR-005 Restriction model:** account-status enum + append-only time-bound restriction rows; automated=reversible, REVOKE=admin-only.
- **ADR-006 Audit/events:** append-only `SecurityEvent` (TTL retention) + immutable `AdminAction`.
- **ADR-007 Concurrency/DB strategy:** Mongo transactions + conditional atomic updates + unique-index backstops; no Redis.
- **ADR-008 Rate limiting:** DB-backed, multi-dimension (account/IP/endpoint/device), replacing in-memory map.
- **ADR-009 AuthN strategy:** keep password primary; email OTP as step-up/new-device verification only.
- **ADR-010 Access Decision:** single `authorize()` choke point wrapping `requireUser`/`requireAdmin`.
- **ADR-011…ADR-019 (Phase 7.1):** authorization coverage + edge revocation window; session↔device-cookie match; new-device verification (admin-approval/email OTP); admin hardening; multi-instance startup guard; no-secret logging + key rotation; rapid-eviction policy; concrete retention. See `07-final-architecture-decisions.md`.

## 19. Remaining questions

> **Phase 7.1 update:** items 1–8 below were carried into `07-final-architecture-decisions.md`. Resolutions: #2 Cloudflare-trust gates device-binding enforcement (ADR-012) and geo weight; #7 index existence **cannot be verified from repo** — run `getIndexes()` on prod (see 07); #8 retention set to 180d events / ≥2yr admin audit (ADR-019). #1 (email provider), #3 (concurrency default) remain **BUSINESS DECISION REQUIRED**.

1. **Email provider** for OTP step-up (Phase 1–3 open) — now scoped narrowly (verification + security notices only). Which provider / deliverability?
2. **Cloudflare trust guarantee** — is the origin provably locked to Cloudflare so `cf-connecting-ip`/`cf-ipcountry` can be trusted? Until confirmed, geo signals stay near-zero weight.
3. **Concurrency policy sign-off** — accept the configurable default (protects multi-device) vs. strict `=1`? Business decision with documented UX cost.
4. **Device-limit defaults & churn cool-down values** — set with business.
5. **Geo/ASN provider** if not Cloudflare (MaxMind?) — privacy trade-off.
6. **BFLA cross-tenant rate routes** — confirmed in-scope to fix under §11, or tracked separately?
7. **Prisma `@unique` → real Mongo indexes** confirmation (needed for concurrency backstops) — carried from Phase 1.
8. **Retention windows** for `SecurityEvent` vs `AdminAction` — legal/privacy input.

---

PHASE 4 COMPLETE — WAITING FOR PHASE 5.
