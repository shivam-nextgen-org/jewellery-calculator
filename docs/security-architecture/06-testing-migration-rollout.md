# 06 — Testing, Migration, Rollout & Rollback (Phase 6)

> **Status:** Phase 6 (strategy only). **No application code written.** No schema/migration/package/config/deployment change made.
> **Builds on:** analysis 01–03, architecture 04, blueprint 05.
> **Grounding facts:** **Vitest is already the test runner** (`npm run test` = `vitest run`; existing tests under `src/lib/excel`, `src/lib/fx`, `src/lib/services/gold-rate.test.ts`) — **zero auth/session/route tests today** (`01-…` L4). Deployment is **single-instance PM2 fork behind Cloudflare, plain-HTTP origin**. **No OTP/email provider exists.** New security state is DB-backed (Atlas replica set, transactions). Observability today = `console.*` only.

---

## 0. Strategy in one line

Ship the security system as **additive, flag-gated stages** where **every stage defaults to OFF / detect-only ("shadow")** before it ever enforces, so we can watch real customer behavior and prove no false positives *before* any restriction can bite. Nothing is enforced until its shadow metrics are clean.

---

## 1. Test strategy

Use the existing Vitest setup; add security suites under `src/lib/security/**/*.test.ts` and API/integration tests. Recommended additions (dev-only, do not change runtime deps): a test-scoped **ephemeral MongoDB** (mongodb-memory-server or a disposable Atlas test DB) for integration/concurrency tests, and a headless E2E runner (Playwright) for browser flows.

| Layer | Scope | What it proves |
|---|---|---|
| **Unit** | Pure functions: risk rules, token sign/verify, device-secret hashing, restriction expiry logic, rate-limit counters, concurrency-policy decision fn | Deterministic, isolated correctness; risk rules are pure so 100% coverage is feasible |
| **Integration** | Service + real (ephemeral) Mongo: `createSession` transaction, device-limit claim, restriction lifecycle, OTP challenge lifecycle | State transitions + index/constraint behavior against a real DB |
| **API** | Route handlers via app fetch: authZ on every route, error/status contracts, audit-event emission | `authorize()` is actually invoked; contracts unchanged for existing routes |
| **Security** | Adversarial (see §2) | Abuse resistance |
| **E2E** | Playwright: login → new-device OTP → dashboard; logout revokes; multi-tab | Real browser cookie/session behavior |
| **Concurrency** | Parallel calls hitting the same account (see §2) | Race safety of caps |
| **Load** | k6/autocannon against login/session/validate at 100→1k concurrent | Per-request cost stays bounded; async risk path doesn't gate latency |
| **Regression** | Keep existing excel/fx/pricing suites green; snapshot existing API contracts | Product functionality unaffected |

**CI gate:** all suites run in `vitest run`; security + concurrency suites are **required to pass** before any flag can be promoted.

---

## 2. Security tests (adversarial — assert the control holds)

| Attack | Test asserts |
|---|---|
| **OTP brute force** | After N wrong codes the challenge locks; codes are single-use; rate limit returns 429; code never appears in logs |
| **Session theft / replay** | A copied session JWT stops working once the server `Session` is `REVOKED`; expired/for-another-device tokens rejected; `logout` truly kills the session (fixes `02-…` S3/T1) |
| **Token replay** | Reusing an old JWT after rotation/revoke fails; `exp` honored; no acceptance of `alg:none`/tampered signature |
| **Device spoofing** | Forged/guessed `atelier_device` cookie doesn't match any `secretHash` → treated as new PENDING device, not trusted; client-asserted UA never grants trust |
| **API bypass** | Every protected route rejects missing/invalid session; the fixed rate-update routes reject a plain USER (admin/cron only) — regression test for the BFLA (`02-…` B1) |
| **IDOR/BOLA** | `GET/DELETE /api/devices/:id`, `/sessions/:id` reject ids owned by another user (403/404); services still take userId from server context, never body |
| **Concurrent login** | K parallel logins for one account never exceed `maxConcurrentSessions`; partial-unique index + transaction produce deterministic winner; losers get conflict, not a second active session |
| **Device-limit race** | K parallel new-device verifications never exceed `deviceLimit`; slot cool-down prevents instant churn re-use |
| **Privilege escalation** | USER cannot reach `/admin*` or `/api/admin/security/*` (middleware + `requireAdmin`); tampered JWT `role` fails signature |
| **Admin abuse** | Every admin security action writes an `AdminAction`; high-impact actions require step-up; no lift/override path exists without an audit row |

---

## 3. Legitimate-user tests (assert NO false positive)

Explicit "must-not-restrict" suite covering `03-…` §6 / `04-…` §5:

| Legit behavior | Expected result |
|---|---|
| Home Wi-Fi → office Wi-Fi → mobile data (same device) | No restriction; IP/geo change is low/near-zero weight |
| Laptop + phone (within device limit) | Both usable; concurrency policy does not lock out the multi-device customer |
| Travel across cities/countries (sequential, not concurrent) | No impossible-travel trigger |
| Browser update (UA changes) | Same device credential → still trusted |
| OS reinstall / cleared cookies | New PENDING device → verification (or grandfather on migration), never hard lockout |
| Device replacement (occasional) | Self-service remove + re-verify works; churn cool-down doesn't punish a single replacement |
| Routine re-login after "remember me" lapse | No flag |

**Acceptance bar:** during shadow rollout, the false-positive rate on real traffic must be effectively zero before an enforcement flag is promoted.

---

## 4. Migration strategy (no customer broken)

Reaffirms `05-…` §11 with test/observability hooks. Additive + reversible throughout.

```
Existing USER ──▶ backfill License(status=ACTIVE, default limits) ──▶ shadow session write on next login
      │                                                                        │
      └──▶ grandfather current device (auto-TRUST, no OTP) ──▶ gradual enforcement per flag (detect→enforce)
```

1. **Additive schema + `ensureIndexes()`**; confirm/repair `User.email` & `ApiKey.prefix` unique indexes (Prisma may not have created them — `01-…` §10).
2. **Backfill `License`** for every existing USER (`ACTIVE`, default `deviceLimit`/`maxConcurrentSessions`/`policy`) — encodes "lifetime access preserved."
3. **Session shadow-run:** write `Session` rows on new logins; keep honoring existing stateless JWTs until they expire (grace window) so **no one is logged out**.
4. **Device grandfather:** on next login, auto-trust the current device (no OTP) up to the limit; only *additional* new devices go through verification.
5. **Gradual enforcement** via flags (§5), each in **detect-only first**, then enforce, one at a time.
6. **No** password resets, forced re-login, or destructive rewrites — ever.

---

## 5. Feature flags (all default OFF; each has a detect-only mode)

Config-driven (env/config module), readable by `authorize()` and services. Recommended set:

| Flag | Controls | Modes |
|---|---|---|
| `SECURITY_SESSIONS_ENABLED` | server-tracked sessions + revocation | off / shadow(write only) / enforce |
| `SECURITY_DEVICE_TRUST_ENABLED` | device model + limit | off / detect / enforce |
| `SECURITY_DEVICE_VERIFICATION_ENABLED` | OTP step-up for new devices | off / on (**requires email provider**) |
| `SECURITY_CONCURRENCY_ENABLED` | concurrency policy | off / detect / enforce |
| `SECURITY_RISK_ENGINE_ENABLED` | risk evaluation | off / log-only / act |
| `SECURITY_RESTRICTIONS_ENABLED` | automated restrictions | off / on (admin-only restrictions always available) |
| `SECURITY_RATE_LIMIT_DB` | DB-backed rate limiting | off(in-memory legacy) / on |
| `SECURITY_ADMIN_STEP_UP` | re-auth/OTP on high-impact admin actions (ADR-015) | off / on (**required at launch**) |

**Rule:** a flag only advances a mode after its metrics (§8) show clean shadow/detect results. Enforcement flags are per-stage so one can be rolled back without touching others.

**Startup guard (ADR-016, doc 07):** if the app runs as multiple instances (`pm2 -i`/cluster worker index > 0 or `APP_INSTANCES>1`) while `SECURITY_RATE_LIMIT_DB` is off, it must **refuse to start** (or force DB-backed rate limiting), and the in-process cron must run single-leader (DB lock). Single-instance PM2 fork (current deployment, `START.md`) is unaffected.

---

## 6. Rollout

```
Development (unit/integration/security suites green)
   ↓
Staging (E2E + load + concurrency; seeded data)
   ↓
Internal testing (team dogfoods multi-device, travel, reinstall scenarios)
   ↓
Controlled production — DETECT/SHADOW only (no enforcement; watch metrics on real customers)
   ↓
Monitoring window (false-positive rate ≈ 0, no anomalies)
   ↓
Gradual enforcement (flip flags one at a time, in order: sessions → device limit → concurrency → risk act → restrictions)
   ↓
Full rollout (retire legacy stateless-JWT acceptance after grace window)
```

**Ordering rationale:** sessions first (foundation for revocation), then device trust (needed by concurrency/risk), then concurrency, then risk actions, then automated restrictions last (highest false-positive risk). **Prerequisite before any multi-instance/`pm2 -i`:** `SECURITY_RATE_LIMIT_DB=on` and sessions enabled, because in-memory state breaks under clustering (`01-…` H2).

---

## 7. Rollback (per change)

| Change | Rollback | Customer protection |
|---|---|---|
| Server sessions | Set `SECURITY_SESSIONS_ENABLED=shadow/off`; keep honoring valid JWTs | No logouts; legacy path intact during grace |
| Device trust/limit | Flag → off/detect | Everyone treated as trusted; no lockout |
| Device verification (OTP) | Flag off → skip OTP, grandfather devices | Email outage never blocks trusted devices (`04-…` §14) |
| Concurrency | Flag → detect/off | Unlimited sessions restored |
| Risk engine | Flag → log-only/off | No automated actions |
| Restrictions | Flag off + admin bulk-lift; restrictions are append-only so history preserved | Access restored immediately |
| DB rate limiting | Flag → legacy in-memory | Login still protected |
| Schema | Additive only → leave new collections in place (inert when flags off); never drop mid-incident | No data loss |

**Golden rule:** because every stage is additive and flag-gated, rollback = flip a flag, never a data migration. Legacy auth is not removed until enforcement is proven stable.

---

## 8. Observability

Today the app only uses `console.*`; the security system needs structured signal. Minimal additions (no heavy infra required — start with structured logs + the `SecurityEvent`/`AdminAction` collections, add a metrics endpoint/dashboard as needed):

- **Logs:** structured JSON security logs (event type, reasonCodes, userId, requestId, ipHash) — never raw codes/secrets/PII. Correlate via `requestId`.
- **Metrics (counters/gauges):** login success/failure rate, OTP send/verify/fail rate, new-device registrations, device-limit-hit count, **concurrent-session-detected count**, restriction created/lifted, admin actions, risk-tier distribution, **false-positive proxy** (restrictions later lifted by admin as "legitimate").
- **Alerts:** spike in OTP failures (brute force), device explosion / high churn on one account, surge in CONCURRENT_SESSION_DETECTED, unusual admin-override volume, risk-engine or DB error rate up, **restriction rate above baseline during shadow** (would block promotion).
- **Dashboards:** per-customer security timeline (from `SecurityEvent`); fleet view of risk-tier distribution and restriction volume; migration/rollout progress (shadow vs enforce counts).
- **Security events:** the append-only `SecurityEvent` collection (05 §1.4/§10) is the source of truth; `AdminAction` is the TTL-exempt audit trail.

**Shadow-mode is the key observability tool:** detect-only stages emit the *same* events they would in enforce mode, tagged `wouldHaveActed=true`, so we measure impact on real customers with zero risk before enforcing.

---

## 9. Open items carried to final review

> **Phase 7.1 update:** resolutions recorded in `07-final-architecture-decisions.md`. Remaining **BUSINESS DECISIONS**: email provider choice, concurrency numeric defaults, admin-MFA owner/date, legal retention confirmation. **Ops prerequisite**: verify live Mongo unique indexes via `getIndexes()` before enforcement (cannot be verified from repo). Retention set to 180d (events/risk) / ≥2yr (admin audit) — ADR-019.

- Email provider (gates `SECURITY_DEVICE_VERIFICATION_ENABLED`; launch uses admin-approval fallback — ADR-013).
- Cloudflare trust confirmation (gates geo-signal weight **and** device-binding enforcement — ADR-012).
- Concurrency default + policy sign-off (BUSINESS — Biz-A).
- Retention windows — **set** (ADR-019); confirm legal fit.
- Live Mongo unique indexes — **cannot verify from repo**; run `getIndexes()` on prod.
- BFLA rate-route fix confirmed in-scope (regression test included in §2).

---

PHASE 6 COMPLETE — WAITING FOR FINAL REVIEW.
