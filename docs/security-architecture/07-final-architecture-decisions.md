# 07 — Final Architecture Decisions (Phase 7.1)

> **Status:** Phase 7.1 (decision + documentation only). **No application code, schema, migration, API, frontend, config, or deployment was modified.**
> **Purpose:** Resolve the blocking (G1–G3, business sign-offs, index verification) and strongly-recommended (G5–G8) items from the Phase 7 review, as ADR-style decisions. Then apply targeted edits to docs 04–06 (done — see change log at the end).
> **Grounding re-verified this phase (from the actual repo):**
> - **No email provider / no OTP / no email transport** anywhere (`grep`: no nodemailer/smtp/resend/sendgrid/postmark/mailgun). Email verification is **greenfield**.
> - **No runtime index creation** (`grep`: no `createIndex`/`ensureIndex` in `src/`). Indexes exist only if `prisma db push` was run — which `README.md` documents as a manual first-time step (`npx prisma db push`) and `deploy/.../START.md` calls "optional." So Prisma-managed unique indexes on `User.email`/`ApiKey.prefix` **probably** exist but are **not verifiable from repo code**.
> - **Deployment is single-instance PM2 fork** (`START.md`: `pm2 start server.js --name atelier` — no `-i`/cluster), plain-HTTP origin, Cloudflare assumed for TLS.
> - Admin seed uses hard-coded fallbacks in `prisma/seed.ts` (`SUPER_ADMIN_EMAIL ?? "admin@atelier.local"`, `SUPER_ADMIN_PASSWORD ?? "AtelierAdmin@2026"`), and these are commented-out in `.env.production.example`.

---

## G1 — Authorization coverage & edge revocation window

**Issue:** `authorize()` runs in the Node runtime; edge middleware is intentionally DB-free. If any user-data surface is gated only at the edge, a revoked session could still read data until the JWT expires.
**Why it matters:** "force logout / suspend / revoke" is a headline requirement; it is only real on surfaces that call `authorize()`.
**Current architecture:** Today (repo) every API route calls `requireUser()`/`requireAdmin()`, **except** server components: `admin/page.tsx`, `dashboard/page.tsx`, `layout.tsx` call services/`getSession()` directly without a guard. Next.js App Router: this app uses **API route handlers + server components**; a repo search shows **no server actions** (`"use server"`) and no custom loaders — data is fetched in route handlers and in server-component `async` bodies.
**Recommended decision — authorization coverage rule (ADR-011):**
- `authorize(ctx)` (wrapped by `requireUser`/`requireAdmin`) **must be invoked by every surface that returns or mutates user/customer data**:
  1. **All `/api/**` route handlers** (already the pattern) — extend the two auth-after-parse routes to call it *before* body parsing.
  2. **Every server component that reads user data** — `dashboard/page.tsx`, `history/page.tsx`, `pricing/**`, and **`admin/page.tsx`** must call the guard themselves (fixes `02-…` H3 / A2), not rely on middleware.
  3. **`layout.tsx`** may keep a soft `getSession()` for nav chrome only (no data), so it is exempt — but must render nothing sensitive.
  4. **Internal service calls** (`src/lib/services/*`) stay identity-by-parameter (never read the session) — the caller (route/component) is responsible for `authorize()`. This preserves the current no-IDOR property.
  5. If server actions are ever added, they are treated as API routes (must call `authorize()`).
- **Edge middleware remains DB-free** and does only signature/expiry/role routing.
**Edge revocation window (explicit):** **≤ 60 seconds, and only for non-data navigation.** Any request that returns or mutates user data hits `authorize()` and is revoked **immediately** (next request). The only "window" is a page shell/redirect that renders no user data; even then the first data fetch inside it is authorized. We do **not** cache authorization decisions. (If a future perf need introduces caching of `authorize()` results, max TTL = 60s, and revoke/suspend must bust it.)
**Alternatives considered:** (a) DB call in edge middleware — rejected: edge runtime + per-asset latency; (b) unlimited edge trust until JWT expiry — rejected: makes revocation cosmetic.
**Security impact:** high positive — revocation becomes effective everywhere data flows. **Performance:** one indexed session lookup per data request (acceptable, §15 doc 04). **UX:** none. **Operational:** clear rule for reviewers. **Migration:** during shadow, pre-cutover JWTs are ALLOW+LOG (doc 05 §11).

---

## G2 — `session.deviceId` vs presented device cookie

**Issue:** Sessions are bound to a device, but nothing said the session is checked against the *presented* `atelier_device` cookie each request. Without it, a stolen session cookie is portable and device-binding is nominal.
**Why it matters:** device binding is the anti-portability control; the device limit is meaningless if a session works from any browser.
**Current architecture:** no device cookie exists today; session cookie alone authorizes.
**Recommended decision (ADR-012):** In `authorize()`, resolve the device from the presented `atelier_device` cookie (`sha256` → `Device` row) and require:
```
resolveDevice(atelier_device).id === session.deviceId
AND device.status == TRUSTED
   → continue
MISMATCH or missing/unknown/untrusted device
   → deny session (401 → re-authenticate)
   → emit SecurityEvent (SESSION_DEVICE_MISMATCH)
   → strong risk signal (feeds risk engine; possible restriction if repeated)
```
**Device cookie properties (final):** name `atelier_device`; **HttpOnly=true**; **Secure** = same policy as session (`COOKIE_SECURE`/prod — see note); **SameSite=Lax**; **Path=/**; **maxAge ≈ 400 days** (long-lived credential); value = opaque CSPRNG secret (only `sha256` stored server-side).
**Rotation:** rotate the device secret (re-issue cookie, update `secretHash`) on each successful **new-device verification** and optionally on a long cadence; rotation keeps the same `Device._id` so it is not counted as a new device.
**Recovery / replacement / cleared cookies:** missing device cookie ⇒ treated as a **new PENDING device** → verification (or grandfather during migration) → never a hard lockout. Self-service remove + re-verify handles replacement (churn cool-down applies).
**Note (interaction with plain-HTTP origin, `01-…` L1):** if `COOKIE_SECURE=false` is ever used (HTTP), both cookies are exposed on the wire — device binding then only resists *casual* copying, not a network attacker. **Recommendation folded into ADR-012:** require HTTPS at the origin (or provably Cloudflare-only) before enforcing device binding as a security control.
**Alternatives considered:** binding session to IP/UA — rejected (`03-…`: breaks legit network changes / spoofable). **Security:** high positive. **Performance:** one extra indexed device lookup (can be combined with session lookup). **UX:** transparent unless cookie lost (then re-verify). **Operational:** new event type. **Migration:** enforced only after `SECURITY_DEVICE_TRUST_ENABLED=enforce`.

---

## G3 — Email provider / new-device verification (production answer)

**Issue:** New-device verification depends on email OTP; **no email provider exists** and building one is real work.
**Current architecture (verified):** zero email transport in repo/deps.
**How does a new device get verified in production? — decision (ADR-013), two-track:**
- **Launch track (no email dependency): Admin-approval device enrollment.** Because the product is **admin-provisioned** (admins already create every customer — `01-…` §5), admin approval is a natural, low-friction fallback that needs no new infra.
- **Preferred track (when approved): Email OTP** as designed (6-digit, CSPRNG, hashed, 5–10 min TTL, single-use, rate-limited) via a transactional provider. **`BUSINESS DECISION REQUIRED`** — choose provider (e.g. a transactional email service) + accept adding one dependency. Until then, launch on the admin-approval track.

**Admin-approval fallback — full definition:**
- **Customer sees:** "New device detected — pending approval. Ask your administrator to approve this device," with a short reference code; the device stays `PENDING_VERIFICATION` and cannot open a session.
- **Admin notified:** a pending-devices queue in the Admin Security Center (`/admin/security`), plus the `DEVICE_REGISTERED` event; (email/push to admin optional, not required for launch).
- **Admin unavailable:** the pending request **expires after 24h** (`OtpChallenge`/pending-device TTL) and must be re-initiated; existing trusted devices are unaffected, so the customer is never locked out of devices they already use.
- **Expiration:** pending device auto-expires (24h) → `EXPIRED`; slot not consumed.
- **Audit:** `DEVICE_REGISTERED` (request), `DEVICE_VERIFIED` + `ADMIN_ACTION` (approval), `DEVICE_EXPIRED` (timeout) — all in `SecurityEvent`/`AdminAction`.
- **Abuse prevention:** device-registration rate limit (e.g. 5/hour/account, doc 05 §9); repeated pending requests raise a risk signal; admin approval is itself a step-up-gated action.
**Failure behavior:** email-track down ⇒ **fall back to admin-approval**, never auto-trust (fixes the G3 ambiguity in doc 04 §14). Already-trusted devices always keep working.
**Alternatives considered:** SMS OTP (needs a provider + phone numbers we don't collect — rejected for launch); password re-entry as "verification" (no assurance the person is the owner — rejected as sole control). **Security:** admin-approval is strong (human gate) but slower; email OTP is faster, self-service. **UX:** admin-approval adds latency for new devices (acceptable at current customer scale). **Operational:** admin workload scales with new-device rate. **Migration:** device grandfathering avoids a launch spike.

---

## Business decision A — Concurrent sessions

**Issue:** Strict `maxConcurrentSessions=1` vs configurable default.
**Options:**
- **Option 1 — Strict `=1` (global, DENY or NEWEST_WINS).** Strongest anti-sharing, but a legitimate laptop+phone customer is logged out on every switch (`03-…` Scenario A/F). High support/UX cost.
- **Option 2 — Configurable per-license, default set by business, `NEWEST_WINS`+notify + `STEP_UP` on different-device contention.** Protects multi-device customers; still catches genuine simultaneous multi-person use via distinct-device concurrency + risk.
**Recommended option:** **Option 2**, with a recommended default of **`maxConcurrentSessions = 1` per *device*** but **device limit ≥ 3** and policy `NEWEST_WINS` — i.e. one active session per device, several trusted devices allowed. This gives "one human, several of their own devices" while blocking "many simultaneous strangers." **`BUSINESS DECISION REQUIRED`:** confirm the numeric default (`maxConcurrentSessions`, `deviceLimit`) and whether you want the stricter global `=1`. The architecture supports either without redesign.
**Impacts:** Option 2 — Security: strong when combined with device limit + risk; Performance: identical; UX: low friction; Operational: fewer false lockouts; Migration: default applied at License backfill.

---

## Business decision B — Email OTP as step-up (not primary)

**Issue:** Is email OTP sufficient as **step-up** (new device, suspicious login, sensitive recovery), and is keeping **password as primary** acceptable?
**Distinction (final):**
- **Primary authentication = email + password (bcrypt).** Unchanged. It authenticates *who you are*.
- **Step-up authentication = email OTP (or admin approval fallback).** Invoked for: new-device enrollment, HIGH-risk logins, and sensitive account recovery. It authenticates *control of the registered email / device*, not a new primary factor.
**Recommendation:** **Yes** — email OTP is sufficient and appropriate as step-up; it should **not** replace password as primary (OTP is as shareable as a password → no anti-sharing benefit, and rebuilding primary auth on a live product is high-risk). **`BUSINESS DECISION REQUIRED`:** confirm this framing (password primary, OTP/admin-approval step-up).
**Impacts:** Security: adds a second factor exactly where risk is highest; UX: friction only on new device / high risk; Operational: depends on provider (G3); Migration: none for existing sessions.

---

## Index verification (Mongo)

**Production index existence cannot be verified from repository code alone.** The repo declares `@unique` in Prisma but creates no indexes at runtime; whether they exist depends on `prisma db push` having been run against the live Atlas cluster (a manual step per `README.md`).

| Index | Expected | Code declaration | Creation mechanism | Verifiable locally? | Verifiable in prod from repo? |
|---|---|---|---|---|---|
| `User.email` unique | unique | Prisma `@unique` | `prisma db push` (manual) | Only against a local DB you push to | **No** |
| `ApiKey.prefix` unique | unique | Prisma `@unique` | `prisma db push` (manual) | Same | **No** |
| `Device.secretHash` unique | unique | **new** (doc 05 §1.2) | new `ensureIndexes()` (not built) | After implementation | **No** |
| `Session` partial-unique active-per-device | partial unique | **new** (doc 05 §1.3) | new `ensureIndexes()` (not built) | After implementation | **No** |

**Production verification procedure (run before enforcement, not in this phase):**
```
// against production Atlas, read-only:
db.User.getIndexes()      // expect a unique index keyed { email: 1 }
db.ApiKey.getIndexes()    // expect a unique index keyed { prefix: 1 }
```
If either unique index is **absent**, create it (with duplicate pre-check) **before** relying on it. The new `Device`/`Session` indexes are created by the future idempotent `ensureIndexes()` bootstrap (doc 05 §0) and must be confirmed present after deploy. **ADR-014:** the app must run `ensureIndexes()` at startup (idempotent) so index existence stops depending on a manual CLI step.

---

## G5 — Admin hardening (promote to required)

**Decision (ADR-015) — now REQUIRED, not recommended:**
1. **No fallback/default production admin credentials.** The `?? "admin@atelier.local"` / `?? "AtelierAdmin@2026"` fallbacks in `prisma/seed.ts` must be removed; seed must **fail** if `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` are unset. (Doc/code change deferred to implementation; recorded here as a requirement.)
2. **Step-up required for high-impact admin actions:** remove restriction, change device/concurrency limits, revoke license, force-logout, modify security settings, controlled override. Mechanism: re-enter password + (when available) OTP; every such action writes an `ADMIN_ACTION`.
3. **Admin MFA:** **Required (target), phased.** Mechanism: email OTP step-up at launch (reuses G3), TOTP as the preferred longer-term second factor. **Rollout:** step-up first, TOTP when the email/OTP channel is live. **Ownership:** `BUSINESS DECISION REQUIRED` — assign an owner + date. **Recovery:** admin account recovery only via another admin or a documented break-glass procedure (not self-serve). **Audit:** all admin auth + step-up events logged.
**Impacts:** Security: closes the highest-value compromise path (`02-…` AD2/AD3); UX: minor admin friction; Operational: define break-glass; Migration: none for customers.

---

## G6 — Multi-instance vs DB-backed rate limiting

**Issue:** In-memory rate limiter + per-process cron guard are correct only single-instance; DB-backed rate limiting defaults OFF (doc 06 §5).
**Current architecture (verified):** `START.md` documents **single-instance** PM2 fork (no `-i`). Nothing enforces it.
**Decision (ADR-016):** Add a **startup guard** (documented requirement, implemented later):
- If the process detects it is one of multiple instances (e.g. `pm2 -i`, `NODE_APP_INSTANCE`/cluster worker index > 0, or an explicit `APP_INSTANCES>1` env) **and** `SECURITY_RATE_LIMIT_DB` is off, **refuse to start** (fail-closed) with a clear error, **or** auto-treat rate limiting as DB-backed. Also, the in-process cron (`instrumentation.ts`) must run on **only one** instance (leader election via a DB lock) to avoid duplicate rate writes (`01-…` H2).
**Safe behavior summary:** single-instance → current behavior fine; multi-instance → DB-backed rate limiting is mandatory and crons are single-leader.
**Impacts:** Security: prevents silent rate-limit degradation; Performance: negligible; Operational: explicit, safe scaling path; Migration: none until scaling.

---

## G4 / G7 / G8

**G4 — Session logging & key rotation (ADR-017):**
- **Never log raw `sessionId`, device secrets, OTP codes, JWTs, or `SESSION_SECRET`.** Safe-to-log identifiers: `userId`, a **truncated/hashed** session reference (e.g. first 8 chars of `sha256(sessionId)`), `deviceId` (opaque ObjectId, not the secret), `requestId`, event `type`, `reasonCodes`, `ipHash`, coarse geo.
- **Key rotation roadmap:** introduce a **`kid`** header on session JWTs; maintain a small keyring `{ kid → secret }` in env/secret store. Rotation cadence **≥ every 90 days or on suspected compromise**; **overlap period** = max session lifetime (30 days) so old-key tokens verify until they expire; after overlap, retire the old key. **Rollback:** keep the previous key in the ring one extra cycle. Because sessions are also DB-validated, a rotated key does not force mass logout.

**G7 — Rapid eviction ↔ concurrency policy (ADR-018):** With `NEWEST_WINS`, each new login can evict the prior session. Wire the existing **"repeated session invalidation / rapid session switching"** signal (`03-…` §4, doc 04 §7) directly to this policy: if evictions on one account exceed a threshold in a rolling window (e.g. > N in M minutes), the risk engine escalates (MEDIUM→HIGH), requires **step-up on the next login**, and surfaces to admin. This stops two people (or an attacker) from ping-ponging a shared account.

**G8 — Concrete retention periods (ADR-019), with reasoning:**
| Data | Retention | Reasoning |
|---|---|---|
| `SecurityEvent` (raw) | **180 days** (TTL) | Enough for incident investigation and seasonal abuse patterns; bounded to limit PII (ipHash/geo) exposure and storage growth (highest-volume collection). |
| `RiskAssessment` | **180 days** (TTL) | Matches event window so assessments remain explainable against their source events. |
| `Device` records | **active: lifetime; REVOKED/EXPIRED: 400 days** then TTL | Active devices are entitlement state; revoked kept ~13 months for churn/abuse audit, aligned with device-cookie maxAge. |
| `Session` records | **live only** (TTL at `expiresAt`, ≤30 days) | No value after expiry; terminal facts already captured in `SecurityEvent`. |
| `AdminAction` (audit) | **≥ 2 years, TTL-exempt** | Accountability for privileged actions (license revoke, overrides); longer legal/dispute horizon; low volume. |
| `OtpChallenge`/pending device | **minutes–24h** (TTL) | Single-use, short-lived; must not linger. |
**`BUSINESS DECISION REQUIRED` (light):** confirm 180-day event retention and ≥2-year admin-audit retention meet any legal/privacy obligations in your jurisdiction.

---

## Final blocker table

| ID | Decision | Status | Reason | Owner / Action |
|---|---|---|---|---|
| **G1** | Authorization coverage rule + edge revocation window ≤60s (data always via `authorize()`) | **Resolved** | ADR-011; coverage defined for routes + server components; layout exempt | Engineering (implement guard in server components) |
| **G2** | `session.deviceId` must match presented device cookie; mismatch → re-auth + event + risk | **Resolved** | ADR-012; device-cookie properties fixed | Engineering (enforce in `authorize()`); needs HTTPS origin |
| **G3** | New-device verification = **admin-approval at launch**, email OTP when provider approved | **Resolved (with business input)** | ADR-013; fallback fully specified | **BUSINESS: pick email provider** (else launch on admin-approval) |
| **G4** | No raw sessionId/secret logging; `kid` key-rotation roadmap | **Resolved** | ADR-017 | Engineering |
| **G5** | Remove seed fallback creds (required); step-up on high-impact admin actions (required); admin MFA phased | **Resolved** | ADR-015 | **BUSINESS: assign admin-MFA owner/date** |
| **G6** | Startup guard: refuse multi-instance while DB rate-limiting off; single-leader cron | **Resolved** | ADR-016 | Engineering |
| **G7** | Rapid-eviction signal wired to `NEWEST_WINS` → step-up + escalate | **Resolved** | ADR-018 | Engineering |
| **G8** | Concrete retention periods with reasoning | **Resolved** | ADR-019 | **BUSINESS: confirm legal retention** |
| Biz-A | Concurrency: configurable, default 1/device + deviceLimit≥3, `NEWEST_WINS` | **Open** | Numeric defaults need sign-off | **BUSINESS DECISION REQUIRED** |
| Biz-B | Password primary; OTP/admin-approval step-up | **Open** | Framing needs sign-off | **BUSINESS DECISION REQUIRED** |
| Idx | Live Mongo unique indexes (`User.email`, `ApiKey.prefix`) | **Open — cannot verify from repo** | Not verifiable from code | **Ops: run `getIndexes()` on prod before enforcement** |

---

## Change log (targeted edits applied to existing docs this phase)

- **04-target-security-architecture.md** — §19 remaining-questions annotated with resolutions; ADR index (§18) extended with ADR-011…ADR-019 pointer to this doc.
- **05-technical-security-blueprint.md** — §0 conventions: added `ensureIndexes()`-at-startup requirement (ADR-014) and no-secret-logging rule (ADR-017); §1.3 Session note on device-match (ADR-012); §11 migration note on admin-approval fallback (ADR-013).
- **06-testing-migration-rollout.md** — §5 flags: added `SECURITY_ADMIN_STEP_UP` and startup-guard note (ADR-016); §9 open items updated to point here.

(These edits are documentation-only and were applied in the same phase; see the individual files.)

---

PHASE 7.1 COMPLETE.


---

# Addendum A — Approved business decisions (post-review sign-off)

> These decisions were provided after the Phase 7 review and supersede the corresponding "BUSINESS DECISION REQUIRED" / "Open" rows in the blocker table above. All remain **documentation-only**; no code changed.

## Biz-A — Concurrent sessions & devices (APPROVED)
- `maxConcurrentSessions = 1`, `deviceLimit = 3`, `evictionPolicy = NEWEST_WINS`.
- Semantics: a customer may hold **up to 3 trusted devices** but only **1 active session at a time** across all of them; a new login evicts the existing active session (newest wins).
- **Configurability requirement (binding):** these three values live in `License` (per-customer) with system defaults in one config module. They must **not** be hard-coded across the app; `authorize()` and the session service read them from `License`/config. Admin can change per-customer values via the Security Center (audited).
- **Interaction with G7 (ADR-018):** because `NEWEST_WINS` at `=1` evicts on every device switch, the rapid-eviction risk signal is important — repeated evictions in a short window escalate risk and require step-up on next login. This is what distinguishes a legit user hopping between their 3 devices (occasional) from two people fighting over one account (frequent).

## Biz-B — Authentication (APPROVED, with a factual reconciliation)
- **Decision as stated:** keep existing "email OTP" as **primary**; do **not** introduce passwords; use **step-up** for new device / suspicious activity / account recovery / sensitive security ops; new-device step-up = **admin approval** at launch (no email provider).
- **Factual reconciliation (must read):** the **actual** primary authentication in this repository is **email + password (bcrypt) + JWT** — there is **no OTP and no email provider** (verified, Phases 1–2). Therefore "keep the existing OTP auth" is interpreted, consistent with the two firm constraints *"do not change the existing authentication flow unnecessarily"* and *"do not make email-provider integration a blocker,"* as:
  - **Primary authentication = the existing email + password flow, unchanged.** This project does **not** rebuild primary auth and does **not** add a new password system (none is being *added* — it already exists). Rebuilding primary auth as OTP would both change the existing flow *and* reintroduce the email-provider blocker, contradicting the decision.
  - **Step-up / security verification is the new layer** this project adds: admin-approval at launch, replaceable by email OTP later (ADR-013), used for new device, suspicious activity, account recovery, and sensitive admin actions.
  - **If the intent was actually to build OTP as the primary factor**, that is a larger change to a live product and reintroduces the email-provider dependency — flagged as `BUSINESS CONFIRMATION` in the readiness report. Absent that confirmation, primary auth is left exactly as-is.

## G3 — New-device verification (APPROVED)
- Launch mechanism = **admin-approval enrollment** (ADR-013), not a blocker on email.
- **Replaceability requirement (binding):** verification is behind a `DeviceVerifier` interface with two implementations — `AdminApprovalVerifier` (launch) and a future `EmailOtpVerifier` — selected by config/flag. No caller depends on the concrete mechanism.

## G5 — Admin MFA (APPROVED)
- **Required before full production enforcement** of customer security controls.
- Launch mechanism may be **email-OTP step-up reusing the same step-up channel** (or admin-approval-equivalent) if securely supported; **TOTP is the next enhancement**.
- **All high-impact admin security actions require step-up** (`SECURITY_ADMIN_STEP_UP` on at launch).
- **Owner:** Project/Security Administrator. **Target:** before production enforcement of customer security controls.

## G8 — Data retention (APPROVED as technical defaults, subject to legal/privacy)
SecurityEvent 180d · RiskAssessment 180d · Device active-lifetime / revoked 400d · Session live-only ≤30d TTL · AdminAction ≥2yr · OtpChallenge minutes–≤24h. (Matches ADR-019.)

## Production DB verification (REQUIRED before implementation; do NOT create/modify indexes now)
Run **read-only** against production Atlas:
```
db.User.getIndexes()      // REQUIRE a unique index on { email: 1 }
db.ApiKey.getIndexes()    // REQUIRE a unique index on { prefix: 1 }
```
Do not assume they exist because Prisma declares `@unique`. Do not create or modify production indexes in this phase. If missing, creation (with duplicate pre-check) is an implementation-phase task gated on this report.

## Updated blocker status
| ID | Status after sign-off |
|---|---|
| G1,G2,G4,G6,G7,G8 | **Resolved** (ADRs 011,012,017,016,018,019) |
| G3 | **Resolved** — admin-approval launch, `DeviceVerifier` interface keeps it replaceable |
| G5 | **Resolved (policy)** — admin MFA required before full enforcement; owner assigned |
| Biz-A | **Resolved** — 1 session / 3 devices / NEWEST_WINS, kept configurable |
| Biz-B | **Resolved & CONFIRMED** — primary auth = existing **email + password + bcrypt + JWT**, unchanged; the security system is an additional layer on top. Step-up = admin approval (launch) → email OTP/provider (future), replaceable without redesigning device/session/risk. OTP-as-primary is explicitly **not** in scope. No further Biz-B architecture changes required. |
| Idx | **Open — ops verification** (`getIndexes()` on prod) |


---

# Addendum B — I1 implementation notes (refinements to doc 05)

I1 (security foundation) refined a few blueprint details. These are the current source of truth where they differ from doc 05.

| Topic | Doc 05 said | I1 implements | Why |
|---|---|---|---|
| Index creation | `ensureIndexes()` at app startup (ADR-014) | Controlled script only: `npm run security:indexes` (verify by default, `--apply --confirm-db atelier` to create). Not run at startup. | Production indexes must be created in a controlled deployment step, not silently by a booting server. |
| Collection names | `Device`, `Session`, `SecurityEvent`, `AdminAction` | `SecurityDevice`, `SecuritySession`, `SecurityEvent`, `SecurityAdminAction` | Namespaced so they can't collide with future Prisma models. |
| Prisma schema | New models added | Not modeled in Prisma (comment in `schema.prisma` explains) | `prisma db push` drops indexes it doesn't know about and can't express the TTL indexes. Indexes are owned by `src/lib/security/indexes.ts`. |
| Session id | `Session._id` is the id embedded in the JWT | Opaque CSPRNG session id; only `sessionIdHash` (sha256) is stored | A database read can't be replayed as a live session. |
| Device retention | TTL on revoked devices | `purgeAt` field + TTL index, set only when a device leaves active use | Active devices must never expire; TTL needs a date that is absent while active. |
| License | New `License` collection | Deferred. `authorize()` maps the existing `User.isActive` to `ACTIVE`/`SUSPENDED` | I1 creates only what I1 needs; the decision engine already accepts every `License` status. |
| Access-decision flag | (not listed) | `SECURITY_ACCESS_DECISION=off\|shadow\|enforce`, default `off` | Lets the live account re-check roll out in shadow before it can block anyone. |
| Limits | In `License` + config | Config module now: `SECURITY_DEVICE_LIMIT` (default 3), `SECURITY_MAX_CONCURRENT_SESSIONS` (default 1), `SECURITY_EVICTION_POLICY` (default `NEWEST_WINS`). Invalid values fall back to defaults. | Per-customer overrides arrive with `License`. |


---

# Addendum C — I2 decisions and implementation notes

Approved decisions (I2 conflict resolution): **1B**, **one-time auto-trust**, **new customers' first device auto-trusted**, plus the listed defaults.

| Topic | Decision / implementation |
|---|---|
| Session transport (supersedes ADR-002's "JWT carries `sessionId`") | Opaque session id in a separate HttpOnly `atelier_sid` cookie (SameSite=Lax, Secure per cookie policy, same lifetime as the JWT). JWT format unchanged. |
| Cutover rule | `SECURITY_SESSIONS_CUTOVER_AT` (ISO-8601). A JWT whose existing `iat` is at/after it must present a valid `atelier_sid` for the same user; older JWTs are legacy and aren't session-checked until they expire (≤30 days). `SECURITY_SESSIONS_ENABLED=enforce` without a cutover is downgraded to `shadow`. |
| Grandfathering | `SecurityAccount.enrolledAt` is set atomically the first time a customer registers a device; that one device is `TRUSTED`. Never cleared (except to undo a failed insert in the same operation). All later devices are `PENDING_VERIFICATION` until I3. Applies to existing and new customers alike. |
| Device limit | `SecurityAccount.deviceSlotsUsed`, claimed with a conditional atomic `findOneAndUpdate` (`deviceSlotsUsed < limit`). Pending and trusted devices hold a slot; revoking releases it exactly once. `recountDeviceSlots()` repairs the counter (admin primitive for I7). |
| Pending devices and sessions (refines doc 04 §5) | Pending devices may hold a session; the device check reports them `UNTRUSTED`. When device trust is enforced the outcome is the same as "only trusted devices hold sessions", and an I3 approval takes effect without a re-login. |
| Device-trust enforcement in I2 | Not available: `SECURITY_DEVICE_TRUST_ENABLED=enforce` downgrades to `detect` until I3 flips `DEVICE_VERIFICATION_AVAILABLE`. |
| Per-component enforcement | `SECURITY_ACCESS_DECISION` is the master switch. The account check always counts; the session/device checks block only when their own flag is `enforce`, otherwise they're recorded as `ACCESS_WOULD_DENY`. |
| Re-login on the same device | Replaces that device's previous session (`REPLACED`). Backstop: partial unique index `session_active_per_device_unique` (`{deviceId}` where `status=ACTIVE`). Not the concurrent-session limit (I4). |
| Scope | Customers only. API keys and admins are not device/session-checked in I2. |
| Protected pages (G1) | `getPageAccess()` in dashboard, history, products, pricing, settings, admin. A denied user sees an "Access restricted" notice (a redirect to /login would loop). |
| Account deletion | Also deletes the customer's `SecurityDevice`, `SecuritySession` and `SecurityAccount` records; security events stay for their retention period. |


---

# Addendum D — I3 device verification (admin approval)

| Topic | Decision / implementation |
|---|---|
| Verifier abstraction | `DeviceVerifier` (`src/lib/security/verifier.ts`): `onPendingDevice`, `customerState`, `method`. Launch implementation `admin-approval`; selected by `SECURITY_DEVICE_VERIFIER` (only `admin-approval` is accepted). Completion always goes through `trustPendingDevice()`, so a future email-OTP verifier adds a class, not a new state machine. |
| State machine | `PENDING_VERIFICATION` → `TRUSTED` (approve, before deadline) / `REVOKED`+`ADMIN_REJECTED` (reject) / `REVOKED`+`USER_REVOKED` (customer) / `EXPIRED` (24h). `REVOKED` and `EXPIRED` are terminal. Each transition is one conditional atomic update on `status: PENDING_VERIFICATION`. |
| Expiry | `pendingExpiresAt = createdAt + 24h` (pre-I3 pending devices fall back to `createdAt + 24h`). Approval needs `deadline > now`, expiry needs `deadline <= now`, so they can't both apply. Expired requests are swept when the customer registers or lists devices and when the admin opens the queue; the request context treats an overdue request as `EXPIRED` even before the sweep. |
| Only two ways to become TRUSTED | The one-time enrollment (I2, unchanged) and `trustPendingDevice()`. Logging in again never trusts or extends a pending device. |
| Admin step-up (ADR-015) | Password re-entry on **every** approve/reject; no cached step-up. Failures are counted in `SecurityEvent`; 5 failures in 15 minutes locks step-up for that admin (checked before bcrypt). Always required for device decisions, independent of `SECURITY_ADMIN_STEP_UP`. This is re-authentication, not MFA. |
| Ownership (IDOR) | Admin must name the customer (`userId`) and the device must belong to that customer account (`role: USER`); otherwise 404. |
| Audit ordering | `SecurityAdminAction` row (`DEVICE_APPROVED` / `DEVICE_REJECTED`, reason, admin, target) is written **before** the transition; if it fails, nothing changes. The device's `decisionActionId` names the row that took effect. No-op decisions (already decided / expired) write no audit row. |
| Enforcement gate | `SECURITY_DEVICE_TRUST_ENABLED=enforce` now requires HTTPS cookies, `SECURITY_DEVICE_VERIFICATION_ENABLED=on` and `SECURITY_SESSIONS_CUTOVER_AT`; otherwise `detect`. `DEVICE_VERIFICATION_AVAILABLE` flipped to `true` after the I3 suites passed. |
| Customer waiting state | Login response gains `device: { status: "PENDING_APPROVAL", referenceCode, expiresAt }` only for pending devices. Protected pages show "Waiting for approval" with the reference code (also shown to the admin) when enforced, or an expired/rejected/removed notice. |
| Production gate still open | Admin MFA is required before production enforcement (Addendum A, G5). Password step-up does not satisfy it. |


---

# Addendum E — I4 concurrent-session enforcement (NEWEST_WINS)

| Topic | Decision / implementation |
|---|---|
| Algorithm (ADR-007, optimistic concurrency) | Per-customer counter `SecurityAccount.sessionGeneration`, claimed with an atomic `$inc`. Login: insert session (`generationPending`) → claim number → stamp it → sweep older counted sessions (EVICTED) → self-check (evict self if `max` newer counted sessions exist). No transactions, locks, Redis or background job. |
| Authority | Every request re-applies the self-check rule (context.ts): a session with `max` newer counted ACTIVE sessions is refused (`SESSION_EVICTED`, 401) and its row revoked, even if the sweep hasn't run. |
| Winner | Highest stamped generation, which is the login whose `$inc` committed last. Numbers claimed by logins that lost a same-device replacement are left unused. |
| Counted sessions | ACTIVE, not expired, not `pendingExempt`, not `generationPending`. Sessions from before I4 have no generation (= 0): turning enforcement on doesn't end them; the next counted login does. |
| Same device | I2 behaviour unchanged: re-login replaces the device's session (`REPLACED`), not `EVICTED`. |
| Pending devices (refines "a new session on another device evicts the previous one") | While device trust is enforced, a pending device's session is unusable, so it is `pendingExempt`: it neither counts nor evicts. This stops an untrusted device from kicking the customer's trusted session. On approval (I3) it is promoted: claims a number and evicts older sessions. With device trust in `detect`, pending sessions count like any other. |
| Flag | `SECURITY_CONCURRENCY_ENABLED`: `off` (no numbers, no events) / `detect` (numbers + `CONCURRENT_SESSION_DETECTED` with `wouldEvict`, nothing ended) / `enforce` (evicts). `enforce` requires `SECURITY_SESSIONS_ENABLED=enforce` and `SECURITY_EVICTION_POLICY=NEWEST_WINS`, else `detect`; any mode requires sessions on, else `off`. |
| Events (for I5) | `SESSION_EVICTED` (per evicted session: `sessionRef`, device, `evictedGeneration`, `byGeneration`, `byDeviceId`, `sameDevice`), `CONCURRENT_SESSION_DETECTED` (summary per login, mode, count), `SESSION_CREATED` metadata extended (`generation`, `otherDeviceSessions`, `evicted`/`wouldEvict`, `selfEvicted`, `pendingExempt`, `concurrencyMode`). |
| Not covered | Pre-cutover JWTs aren't session-checked, so they aren't subject to the limit until they expire (≤30 days) — documented I2 grace. `DENY_NEW` / `STEP_UP` policies are not implemented. |


---

# Addendum F — I5 risk / abuse detection (advisory)

| Topic | Decision / implementation |
|---|---|
| Engine (doc 04 §7, doc 05 §6) | Pure deterministic rules in `risk-rules.ts` (events → signals → weighted rules → score → tier → recommended action), DB layer in `risk.ts`. Ruleset version `risk-v1.<hash of weights+thresholds>`. |
| Tiers / actions | LOW → `ALLOW` (score 0) or `ALLOW_LOG`; MEDIUM → `STEP_UP`; HIGH → `RESTRICT`; CRITICAL → `REVIEW`. Score bands 20 / 50 / 80. **Recommendations only**; nothing acts on them until I6. |
| Multi-signal caps | 1 behavioural signal → max MEDIUM; 2 → max HIGH; 3+ → CRITICAL possible. Network and geo are supporting only: they count only next to a behavioural signal and add at most 15 together. |
| Execution | After the response (Next.js `after()`), triggered by login success, login failure (existing customer) and admin rejection. Fail-open. No scheduler/background job. |
| Storage | `SecurityAccount.risk` = current result + fingerprint; `SecurityRiskAssessment` = history (180-day TTL), written only when the fingerprint changes. Update is conditional on a different fingerprint and not-newer stored evaluation, so repeated/concurrent evaluations are idempotent. Risk decays as events leave their windows; nothing is permanent. |
| New signals captured | `LOGIN_FAILED` (existing customer, wrong password; recorded after the response, only when the engine is on). Coarse country from `cf-ipcountry` only when `SECURITY_TRUST_PROXY_GEO=on` (default off; requires the Cloudflare-only origin, ADR-012). |
| Flag | `SECURITY_RISK_ENGINE_ENABLED`: `off` (default, nothing read/written) / `log-only` (evaluate + record). `act` is downgraded to `log-only` until I6. Thresholds via `SECURITY_RISK_THRESHOLDS` (JSON, validated; windows capped at 30 days). |
| Privacy | Assessments store counts, reason codes and contributions only — no IPs, IP hashes, device ids or session references. Customers are never shown risk data. |


---

# Addendum G — I6 temporary restrictions

Approved decisions: **1a** (MEDIUM = review flag, no block), **2a** (CRITICAL = block pending review, 7-day maximum, flag remains), **3a** (HIGH = full block for 24 hours), plus the listed defaults.

| Topic | Decision / implementation |
|---|---|
| Mapping | LOW → nothing. MEDIUM → `REVIEW_REQUIRED` flag (access continues). HIGH → restriction `HIGH`, `expiresAt = start + 24h`. CRITICAL → restriction `CRITICAL`, `expiresAt = start + 7d`, review flag set; at expiry the block lifts and the flag stays. |
| Records | `SecurityRestriction` (append-only record: reason, reason codes, tier, score, ruleset version, assessment id, createdBy=null for system, start, expiry, hard max, removal metadata). `SecurityAccount.restriction` = pointer read by `authorize()`; `restrictionVersion` for optimistic concurrency; `restrictionEvidenceAfter`; `review`. |
| States | `ACTIVE` → `EXPIRED` (time) / `REMOVED` (admin); `NOT_APPLIED` = lost the race to claim the account, never enforced. |
| Bounded renewal | Never extended while active. HIGH → CRITICAL once, ending at start + 7 days. After a restriction ends, only events after that moment can create a new one. Lower risk never ends a restriction early. |
| Expiry | Checked on every request (`expiresAt > now`), so it stops blocking immediately; the record is settled lazily after the response and when the admin list is loaded. No background job. |
| Enforcement | `authorize()` maps an active restriction to `TEMPORARILY_RESTRICTED` (403 `ACCOUNT_TEMPORARILY_RESTRICTED`) and a flag to `REVIEW_REQUIRED` (allowed). Disabled accounts (`isActive=false`) stay `SUSPENDED` first. Applies to customer sessions and API keys; admins are never restricted. |
| Admin lift | `POST /api/admin/security/restrictions/:id/lift` `{ userId, password, reason }`: admin session + password step-up → target check → audit row (`RESTRICTION_REMOVED`) → conditional clear (also clears the review flag). Audit failure changes nothing; a repeated lift is a no-op without an audit row. Devices, sessions and the concurrency counter are untouched. List: `GET /api/admin/security/restrictions`. |
| Flags | Enforcement and admin APIs: `SECURITY_RESTRICTIONS_ENABLED=on`. Creating restrictions: `SECURITY_RISK_ENGINE_ENABLED=act`, which is downgraded to `log-only` unless restrictions are on and `SECURITY_ACCESS_DECISION=enforce`. Durations: `SECURITY_RESTRICTION_HIGH_HOURS` (1–168, default 24), `SECURITY_RESTRICTION_CRITICAL_DAYS` (1–30, default 7). |
| Not in I6 | Clearing a review flag without a restriction (I7). Customer step-up for MEDIUM (needs email OTP). |


---

# Addendum H — I7 Admin Security Center

| Topic | Decision / implementation |
|---|---|
| Surface | Pages `/admin/security` (customer list) and `/admin/security/[id]` (detail). APIs `GET /api/admin/security/customers`, `GET /api/admin/security/customers/:id`, `POST /api/admin/security/customers/:id/actions` `{ action, password, reason, ... }`. All 404 unless `SECURITY_ADMIN_SECURITY_CENTER=on`. Existing I3/I6 approve/reject/lift routes unchanged. |
| Authorization | Flag → admin session (`requireAdmin`, JWT role + `authorize()`) → **live** check that the admin is still `SUPER_ADMIN` and `isActive` (also when the access decision is off) → per action: input validation → password step-up (I3 `verifyAdminStepUp`, every action, no caching) → target is a `USER` and the device/session/restriction belongs to them → no-op check → audit → conditional change. There is one admin role; every active admin may manage every customer (no per-admin scoping exists in the model). |
| Actions | `DEVICE_APPROVE`, `DEVICE_REJECT` (I3 flow), `DEVICE_REVOKE` (`ADMIN_REVOKED`), `DEVICE_RENAME`, `SESSION_REVOKE`, `FORCE_LOGOUT`, `REVIEW_CLEAR`, `RESTRICTION_CREATE` (HIGH/CRITICAL, same durations and caps, never replaces or extends an active one), `RESTRICTION_LIFT` (I6 flow), `LIMITS_SET`. No permanent-ban action. |
| Audit | `SecurityAdminAction` row before every applied change; failure → no change. No-ops write no row. Rows hold admin, customer, action, reason, keyed IP hash, target reference. No admin-device reference (admins have no device records). |
| Force logout | Sets `SecurityAccount.sessionsValidAfter` (monotonic `$max`) **before** revoking all active sessions (`ADMIN`). Every request refuses a session created at/before the cutoff, so an in-flight login can't survive it. Devices stay trusted; new logins work. Doesn't cover pre-cutover legacy JWTs (not session-checked). |
| Review clear | Clears `review` only; sets `reviewEvidenceAfter` so the same evidence can't re-flag (MEDIUM). Active restriction, devices, sessions, risk history and events untouched. |
| Limits | Per-customer `deviceLimit` / `maxConcurrentSessions` on `SecurityAccount` (null = configured default), bounds `LIMIT_BOUNDS` 1–10. Device limit is compared inside the atomic slot claim (`$expr`); lowering it removes no devices. Session limit is read on every login sweep and request: lowering it ends the oldest sessions beyond it (NEWEST_WINS). Update is conditional on the values read, so a concurrent change by another admin returns 409. |
| Views | No passwords/hashes, JWTs, session ids or their hashes, device secrets or hashes, API keys, raw IPs. Sessions show a 16-char non-reversible reference; events show an 8-char prefix of the keyed IP hash. |
| Admin MFA (G5) | **Not implemented.** Password step-up is re-authentication, not MFA. Still required before production enforcement; needs a TOTP/second-factor design decision. |
