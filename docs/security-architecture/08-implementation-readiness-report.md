# 08 — Implementation Readiness Report

> **Status:** Planning report only. **No application code, schema, migration, API, frontend, config, or deployment was modified.**
> **Basis:** analysis 01–03, architecture 04, blueprint 05, testing/rollout 06, decisions 07 (incl. Addendum A — approved business decisions).
> **Approval:** architecture **APPROVED for implementation planning**. Implementation has **not** started and will not until an explicit implementation prompt is given.

---

## 1. Final architecture status

**APPROVED.** All Phase 7 blockers (G1–G8) are resolved in documentation; all business decisions (Biz-A, Biz-B, G3, G5, G8) are signed off (doc 07 Addendum A). One **factual reconciliation** is carried as a confirmation item (Biz-B, §2). One item is an **ops prerequisite** (production index verification, §3). No open *technical* blockers remain.

Core shape (unchanged from doc 04): keep the existing edge-middleware + Node-runtime split; add a single `authorize()` Access Decision choke point; introduce server-tracked sessions (JWT carries `sessionId`+`deviceId`, DB is authoritative), a server-issued device credential, a deterministic async risk engine, reversible restrictions, and append-only audit — all in a modular monolith on the existing Next.js + raw-Mongo + Atlas stack. No microservices, no Redis.

## 2. Final business decisions (locked)

| Decision | Value |
|---|---|
| Concurrent sessions (Biz-A) | `maxConcurrentSessions=1`, `deviceLimit=3`, `evictionPolicy=NEWEST_WINS`; configurable per-license, not hard-coded |
| Authentication (Biz-B) | Primary = **existing email+password** (unchanged; no new password system — none is being added, it already exists). Step-up = the new layer (admin-approval at launch, email-OTP later). **Confirmation needed only if OTP-as-primary was truly intended** (would be a large change + reintroduce the email blocker). |
| New-device verification (G3) | Admin-approval at launch; `DeviceVerifier` interface keeps it replaceable by email OTP later; email is **not** a blocker |
| Admin MFA (G5) | Required before full production enforcement; email-OTP/admin step-up at launch, TOTP next; owner = Project/Security Administrator |
| Retention (G8) | Event 180d · Risk 180d · Device active/400d · Session ≤30d · AdminAction ≥2yr · OTP ≤24h (technical defaults, subject to legal) |

**BUSINESS CONFIRMATION (single, non-blocking for planning):** confirm that "keep existing OTP auth as primary" is satisfied by leaving the **existing email+password** flow unchanged (recommended), rather than building OTP-as-primary. If OTP-as-primary is truly required, it becomes a separate, larger workstream with an email-provider dependency.

## 3. Remaining production verification (must run before enforcement; not in this phase)

Read-only, against production Atlas — **do not create/modify indexes now:**
```
db.User.getIndexes()      // REQUIRE unique { email: 1 }
db.ApiKey.getIndexes()    // REQUIRE unique { prefix: 1 }
```
If either unique index is absent, creating it (with a duplicate pre-check) is the first implementation task. Existence **cannot** be confirmed from repository code (Prisma declares `@unique` but nothing creates indexes at runtime; `prisma db push` is a manual step).

## 4. Required implementation phases (proposed; each additive + flag-gated, per doc 06)

- **I1 — Foundation & indexes.** `ensureIndexes()` at startup (ADR-014); verify/create the two unique indexes; add config module for limits/flags; structured security logging (no secrets, ADR-017); `SecurityEvent`/`AdminAction` writers. *No behavior change.*
- **I2 — Server sessions (shadow).** `Session` collection + service; login writes a session and embeds `sessionId`/`deviceId` in the JWT; `authorize()` created and wired into `requireUser`/`requireAdmin`; accept legacy JWTs during grace. Flag `SECURITY_SESSIONS_ENABLED=shadow`.
- **I3 — Device model.** `Device` collection, device cookie, `DeviceVerifier` interface + `AdminApprovalVerifier`; device-match check (ADR-012); grandfather existing devices. Flag `SECURITY_DEVICE_TRUST_ENABLED=detect`.
- **I4 — Concurrency.** Race-safe `createSession` (transaction + partial-unique backstop) enforcing `=1`/`NEWEST_WINS`. Flag `SECURITY_CONCURRENCY_ENABLED=detect→enforce`.
- **I5 — Risk engine.** Deterministic versioned rules, async evaluator on the existing scheduler; rapid-eviction rule (ADR-018). Flag `SECURITY_RISK_ENGINE_ENABLED=log-only→act`.
- **I6 — Restrictions + Admin Security Center.** `AccountRestriction` + `License.status` enforcement; `/admin/security` UI + `/api/admin/security/*`; `SECURITY_ADMIN_STEP_UP` on high-impact actions; remove seed fallback creds (ADR-015).
- **I7 — Hardening & scale-readiness.** DB-backed rate limiting + startup guard (ADR-016); fix auth-ordering routes and BFLA rate routes; constant-time comparisons; key `kid`/rotation scaffold (ADR-017).
- **I8 — Enforcement rollout.** Flip flags in order (sessions → device → concurrency → risk act → restrictions) after shadow metrics are clean; retire legacy-JWT acceptance after grace window.

## 5. Files/modules expected to change (indicative)

- **New:** `src/lib/security/{access,session,device,risk,restriction,events,audit,rate-limit,config,verifier}.ts`; `src/app/api/auth/verify-device/route.ts`, `.../otp/resend` (later); `src/app/api/devices/**`, `.../sessions/**`; `src/app/api/admin/security/**`; `src/app/admin/security/**` UI; an `ensureIndexes` bootstrap (in `instrumentation.ts` or a lib module).
- **Modified:** `src/lib/auth/session.ts` (wrap guards with `authorize()`), `token.ts` (`sessionId`/`deviceId` claims, `kid`), `src/middleware.ts` (extract new claims, stay DB-free), `src/app/api/auth/login/route.ts` + `logout/route.ts`, `ocr/process` & `settings/pricing-defaults` (auth-before-parse), the three rate-update routes (admin/cron only + constant-time), `admin/page.tsx` + user-data server components (call the guard), `prisma/seed.ts` (remove fallback creds), `prisma/schema.prisma` (new models, additive).
- **Unchanged:** all pricing/OCR/domain services (still identity-by-parameter).

## 6. Database migrations required (all additive, non-destructive)

New collections: `License`, `Device`, `Session`, `SecurityEvent`, `RiskAssessment`, `AccountRestriction`, `AdminAction`, (conditional) `OtpChallenge`, (optional) `RateCounter`. Indexes per doc 05 §1 via `ensureIndexes()`. Backfill: one `License{status:ACTIVE, deviceLimit:3, maxConcurrentSessions:1, policy:NEWEST_WINS}` per existing USER. Verify/repair the two existing unique indexes. **No existing collection is altered or dropped.**

## 7. API changes required

- **New:** device self-service (`/api/devices`, `/api/sessions`), device verification (`/api/auth/verify-device`), admin security center (`/api/admin/security/*`). (Doc 05 §2.3.)
- **Modified:** `login` (session+device, rate limit), `logout` (revoke session), `ocr/process` + `settings/pricing-defaults` (auth first + validation), gold/silver/fx `update` (admin/cron only, constant-time).
- **Unchanged contracts:** dashboard/history/products/fx-current (wrapped by `authorize()`, same request/response).

## 8. Frontend / Admin changes required

- **Customer:** new-device "pending admin approval" state on login; device & session management screens (list/rename/revoke).
- **Admin:** new `/admin/security` center (per-customer status, devices, sessions, risk, restrictions, audit timeline, limit editors, pending-device approvals); step-up prompt on high-impact actions. Existing `/admin` users page gains its own server-side `requireAdmin()`.
- Frontend remains presentation-only; all enforcement is server-side.

## 9. Testing requirements (doc 06)

Vitest unit (risk rules, token, device hash, restriction expiry, concurrency decision), integration on ephemeral Mongo (session transaction, device-limit claim, restriction lifecycle), API (authZ + contracts + audit emission), adversarial security suite (all 10 attacks incl. concurrent-login & device-limit races, device-cookie mismatch), legitimate-user "must-not-restrict" suite, concurrency + load tests, regression on existing suites. Security + concurrency suites are CI gates before any flag promotion.

## 10. Rollout strategy

Dev → staging (E2E/load/concurrency) → internal dogfood → **controlled production in detect/shadow only** → monitoring window (false-positive rate ≈ 0) → gradual per-flag enforcement (order in I8) → full rollout, retiring legacy-JWT acceptance after the grace window. Admin MFA + `SECURITY_ADMIN_STEP_UP` must be on before full enforcement (G5).

## 11. Rollback strategy

Every stage is additive + flag-gated → **rollback = flip a flag**, never a data migration. Sessions→shadow/off keeps honoring valid JWTs (no logouts); device/concurrency/risk/restriction flags revert independently; restrictions are append-only so admin bulk-lift restores access; schema changes stay inert when flags are off and are never dropped mid-incident. Legacy auth retained until enforcement is proven.

## 12. Security risks remaining after implementation

- **Device/session cookie theft on a plain-HTTP origin** — device binding (ADR-012) only fully protects over HTTPS; enforce HTTPS/Cloudflare-only origin before treating binding as a hard control. (`01-…` L1)
- **`SESSION_SECRET` compromise** — DB-validated sessions reduce blast radius, but rotation (`kid`) is roadmap, not launch; guard the secret and never log it.
- **Admin-approval verification latency** — until email OTP lands, new-device onboarding depends on admin availability (24h expiry mitigates lockout risk, not delay).
- **Determined single-account sharing within limits** — 1 session / 3 devices makes sharing costly and detectable but not impossible (explicitly a non-goal to make it impossible); risk engine detects churn/eviction/impossible-travel patterns.
- **Geo-signal trust** — impossible-travel/geo weight depends on a provably Cloudflare-only origin (ADR-012); until confirmed, geo stays low-weight.
- **Residual hardening debt** — API-key expiry/per-key limits, TOTP admin MFA, key rotation are follow-ups, not launch blockers.

---

## Final readiness

**READY for implementation planning; NOT YET cleared to write code.** Two gating actions before implementation begins: (1) the single Biz-B confirmation in §2 (recommended answer already documented), and (2) the production index verification in §3. Neither requires code. On your explicit implementation prompt, work would begin at phase **I1**.

STOP — awaiting explicit implementation instruction.
