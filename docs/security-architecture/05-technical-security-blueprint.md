# 05 — Technical Security Blueprint (Phase 5)

> **Status:** Phase 5 (blueprint only). **No application code written.** No schema/migration/package/config/deployment change made.
> **Builds on:** analysis docs 01–03 and architecture doc 04.
> **Audience:** an engineer who will implement in later phases. This is exact enough to follow without re-deriving decisions.
> **Stack facts that shape every detail:** runtime data access is the **raw `mongodb` driver** (Prisma is schema/seed only, `@unique` is *not* guaranteed to exist as a live Mongo index → we create indexes explicitly). Atlas is a **replica set** (multi-doc transactions available). Deployment is **single-instance PM2 fork** today; all new state is DB-backed so multi-instance becomes safe later. No OTP/email provider exists yet.

---

## 0. Conventions

- Collections are created/managed via the raw driver. **All indexes below must be created explicitly** by an idempotent `ensureIndexes()` that **runs at application startup** (ADR-014, doc 07) — do **not** assume Prisma pushed them. Production existence of the *existing* `User.email`/`ApiKey.prefix` unique indexes **cannot be verified from repo code** and must be checked with `getIndexes()` before enforcement (doc 07).
- IDs are Mongo `ObjectId` unless noted. Timestamps are `Date` (server clock, UTC).
- Secrets/tokens stored only as `sha256` hashes; raw values live only in cookies.
- **Logging (ADR-017, doc 07):** never log raw `sessionId`, device secrets, OTP codes, JWTs, or `SESSION_SECRET`. Log `userId`, a truncated `sha256(sessionId)` reference, `deviceId`, `requestId`, event `type`, `reasonCodes`, `ipHash`, coarse geo only.
- "Retention" = TTL index where stated; audit collections are **exempt from TTL**.
- New code lives under `src/lib/security/*`; existing `src/lib/auth/*` is extended, not replaced.

---

## 1. Database design

Reused as-is: **`User`** (the customer/admin; `role`, `isActive`, `email`) and **`ApiKey`**. We add a **`License`** concept rather than overloading `User.isActive`, and five security collections. No existing domain collections change.

### 1.1 `License` (new) — entitlement + per-customer security config
One row per USER (1:1). Represents "lifetime access" + configurable limits, so entitlement is explicit and separate from auth.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId | → User, **unique** |
| `status` | enum `ACTIVE\|REVIEW_REQUIRED\|TEMPORARILY_RESTRICTED\|SUSPENDED\|REVOKED` | default `ACTIVE` (§04 §8) |
| `deviceLimit` | int | default from config (e.g. 3) |
| `maxConcurrentSessions` | int | **default 1** (approved Biz-A); configurable per-license |
| `concurrencyPolicy` | enum `DENY_NEW\|NEWEST_WINS\|STEP_UP` | **default `NEWEST_WINS`** (approved Biz-A) |
| `grantedAt` | Date | |
| `revokedAt` | Date? | set only on REVOKED (admin) |
| `updatedAt` | Date | |

- **Indexes:** `{ userId: 1 }` unique.
- **Security:** only admin paths write `status`/limits/`revokedAt`. Read on every authorize().
- **Growth:** = user count (tiny). **Retention:** lifetime.

### 1.2 `Device` (new)
`User (1) ──< Device`. Server-issued credential; **no fingerprint**.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | this is the `deviceId` |
| `userId` | ObjectId | → User |
| `secretHash` | string | `sha256(deviceSecret)`; raw secret only in `atelier_device` cookie |
| `status` | enum `PENDING_VERIFICATION\|TRUSTED\|REVOKED\|EXPIRED` | only `TRUSTED` may hold active sessions |
| `label` | string? | user-editable ("Work laptop") |
| `platform` / `browserFamily` | string? | coarse, from UA — descriptive only |
| `firstSeenAt` / `lastSeenAt` | Date | |
| `lastIpHash` | string? | `sha256(ip+salt)` — never raw IP |
| `lastCoarseGeo` | string? | e.g. country code, if trusted proxy |
| `verifiedAt` | Date? | |
| `revokedAt` | Date? | slot frees only after churn cool-down |
| `createdAt` / `updatedAt` | Date | |

- **Indexes:** `{ userId: 1, status: 1 }` (list trusted devices, count for limit); `{ secretHash: 1 }` unique (lookup on request); optional `{ userId:1, lastSeenAt:-1 }`.
- **Unique/atomicity:** device-limit enforcement uses a conditional count within a transaction (§5).
- **Growth:** low (device limit × users + churn history). **Retention:** REVOKED/EXPIRED devices retained for audit (or TTL after long window, e.g. 1 yr).
- **Security:** `secretHash` never returned to client; cookie is httpOnly+secure+SameSite=Lax, long maxAge.

### 1.3 `Session` (new)
`Device (1) ──< Session`. Server-authoritative session state (replaces reliance on stateless JWT).

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | this is `sessionId`, embedded in JWT |
| `userId` | ObjectId | → User |
| `deviceId` | ObjectId | → Device (must be TRUSTED) |
| `status` | enum `ACTIVE\|REVOKED\|EXPIRED` | |
| `createdAt` | Date | |
| `lastActivityAt` | Date | throttled updates (≤ once / 60s) |
| `expiresAt` | Date | 7d, or 30d if "remember" |
| `revokedReason` | string? | `LOGOUT\|ADMIN\|CONCURRENCY\|RISK\|DEVICE_REVOKED` |
| `ipHash` / `coarseGeo` | string? | at creation, for impossible-travel |
| `rememberMe` | bool | |

- **Indexes:** `{ _id }` (pk validation); `{ userId:1, status:1 }` (concurrency count, list active); `{ deviceId:1, status:1 }`; **TTL** `{ expiresAt: 1 }, expireAfterSeconds: 0` to auto-purge expired rows.
- **Atomicity backstop:** partial unique index option — at most one `ACTIVE` session per `deviceId`: `{ deviceId:1 }` unique **partial** `{ status:"ACTIVE" }` (prevents duplicate active sessions per device under races).
- **Device-match (ADR-012, doc 07):** on every request, `authorize()` must require `session.deviceId === resolveDevice(atelier_device cookie).id` **and** that device `TRUSTED`; mismatch → 401 re-auth + `SESSION_DEVICE_MISMATCH` event + risk signal.
- **Growth:** active ≈ users × devices; expired auto-purged by TTL. **Retention:** live only; terminal session facts captured in `SecurityEvent`.

### 1.4 `SecurityEvent` (new) — append-only signal + decision log
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | `eventId` |
| `occurredAt` | Date | |
| `type` | enum | see §10 catalog |
| `userId` / `deviceId` / `sessionId` | ObjectId? | context |
| `actorType` | enum `USER\|ADMIN\|SYSTEM\|CRON` | |
| `actorId` | ObjectId? | |
| `ipHash` / `coarseGeo` | string? | minimal PII |
| `reasonCodes` | string[] | explainability |
| `requestId` | string? | correlation |
| `metadata` | object | small, typed per event |

- **Indexes:** `{ userId:1, occurredAt:-1 }` (per-customer timeline); `{ type:1, occurredAt:-1 }` (monitoring); **TTL** `{ occurredAt:1 }, expireAfterSeconds = RETENTION` (e.g. 90–180d).
- **Security:** **write-only from app** (no update/delete code paths). **Growth:** highest-volume collection → TTL is mandatory.

### 1.5 `RiskAssessment` (new)
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId | |
| `evaluatedAt` | Date | |
| `score` | number | sum of rule contributions |
| `tier` | enum `LOW\|MEDIUM\|HIGH\|CRITICAL` | |
| `reasonCodes` | string[] | which rules fired |
| `signalsSnapshot` | object | minimal inputs used |
| `recommendedAction` | enum `ALLOW\|ALLOW_LOG\|STEP_UP\|RESTRICT\|REVIEW` | |
| `rulesetVersion` | string | for reproducibility |

- **Indexes:** `{ userId:1, evaluatedAt:-1 }`; **TTL** on `evaluatedAt` (e.g. 180d). **Growth:** moderate (one per meaningful event/eval).

### 1.6 `AccountRestriction` (new) — append-only, time-bound
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId | |
| `status` | enum matching License states applied | |
| `severity` | enum `LOW\|MEDIUM\|HIGH\|CRITICAL` | |
| `source` | enum `RISK_ENGINE\|ADMIN` | |
| `reason` | string | human-readable |
| `reasonCodes` | string[] | |
| `createdAt` | Date | |
| `expiresAt` | Date? | null = until manual lift |
| `createdBy` | ObjectId? | admin id if source=ADMIN |
| `liftedAt` | Date? | |
| `liftedBy` | ObjectId? | |
| `active` | bool | derived: `liftedAt==null && (expiresAt==null || expiresAt>now)` |

- **Indexes:** `{ userId:1, active:1, createdAt:-1 }`; optional TTL-free (kept for audit). The **License.status** is the fast-path field read by authorize(); restrictions are the history/detail behind it.
- **Security:** REVOKE/SUSPEND only via admin; lifts recorded, never hard-deleted.

### 1.7 (Conditional) `OtpChallenge` (new, only if email OTP is approved)
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `userId` | ObjectId | |
| `purpose` | enum `DEVICE_VERIFICATION\|STEP_UP` | |
| `codeHash` | string | `sha256(code+salt)`; 6-digit CSPRNG |
| `expiresAt` | Date | 5–10 min; **TTL** index |
| `attempts` | int | max e.g. 5 |
| `consumedAt` | Date? | single-use |
| `deviceId` | ObjectId? | device being verified |

- **Indexes:** `{ userId:1, purpose:1 }`; **TTL** `{ expiresAt:1 }`. **Security:** never log code; rate limited (§9).

### 1.8 (Optional) `RateCounter` (new) — DB-backed rate limiting
Replaces the in-memory map so limits survive multi-instance. `{ key, windowStart, count }`, TTL on `windowStart`. Alternatively use atomic `findOneAndUpdate` upserts per window bucket. (§9.)

---

## 2. API design

### 2.1 Existing APIs (behavior preserved; wrapped by new authorize())
| Route | Change |
|---|---|
| `GET /api/dashboard`, `GET /api/history`, `GET/POST /api/products`, `POST /api/ocr/process`, `GET/PUT /api/settings/pricing-defaults`, `GET /api/fx-rates/current` | **No contract change.** They keep calling `requireUser()`, which now internally runs `authorize()` (device/session/restriction/license). Two are also **modified** for hardening (below). |

### 2.2 Modified APIs
| Route | Modification | Reason |
|---|---|---|
| `POST /api/auth/login` | After password verify: resolve device → if new & slot free → `STEP_UP` (issue OTP) → else create server `Session` (concurrency policy) → JWT now carries `sessionId`+`deviceId`. Emit `LOGIN_SUCCESS/FAILED`. DB-backed rate limit. | Core of new model |
| `POST /api/auth/logout` | Revoke server `Session` (`status=REVOKED, reason=LOGOUT`), then clear cookie. | Fix cosmetic logout (`02-…` S3) |
| `POST /api/ocr/process`, `PUT /api/settings/pricing-defaults` | Call `requireUser()` **before** parsing body/allocating buffers; validate payload. | Fix auth-after-work (`02-…` B4/M4) |
| `POST /api/gold-rate/update`, `/api/silver-rate/update`, `/api/fx-rates/update` | Restrict to **admin or cron only** (remove plain-USER path); constant-time secret compare. | Fix BFLA cross-tenant write (`02-…` B1) |

### 2.3 New APIs

**Auth / device (customer-facing):**
| Method · Route | AuthN | AuthZ | Request | Response | Errors | Rate limit | Audit event |
|---|---|---|---|---|---|---|---|
| `POST /api/auth/verify-device` | pending-login token | self | `{ code }` | `{ ok, redirect }` | 400/401/410 expired/429 | per-account+IP | `DEVICE_VERIFIED`,`SESSION_CREATED` |
| `POST /api/auth/otp/resend` | pending-login token | self | `{}` | `{ ok }` | 429/410 | strict per-account | `OTP_SENT` |
| `GET /api/devices` | session | self | — | `[{ id,label,platform,lastSeenAt,status,current }]` | 401 | normal | — |
| `PATCH /api/devices/:id` | session | self (ownership) | `{ label }` | device | 401/403/404 | normal | — |
| `DELETE /api/devices/:id` | session (step-up if sensitive) | self | — | `{ ok, coolDownUntil }` | 401/403/404 | low | `DEVICE_REVOKED` |
| `GET /api/sessions` | session | self | — | `[{ id,deviceLabel,createdAt,lastActivityAt,current }]` | 401 | normal | — |
| `DELETE /api/sessions/:id` | session | self | — | `{ ok }` | 401/403/404 | low | `SESSION_REVOKED` |

**Admin security center (`/api/admin/security/*`, all `requireAdmin` + step-up on high-impact):**
| Method · Route | Request | Response | Audit event |
|---|---|---|---|
| `GET /api/admin/security/users/:id` | — | security status (license, counts, risk tier) | — |
| `GET /api/admin/security/users/:id/devices` | — | device list | — |
| `DELETE /api/admin/security/devices/:id` | reason | ok | `DEVICE_REVOKED` + `ADMIN_ACTION` |
| `GET /api/admin/security/users/:id/sessions` | — | sessions | — |
| `POST /api/admin/security/users/:id/logout-all` | reason | ok | `SESSION_REVOKED*` + `ADMIN_ACTION` |
| `GET /api/admin/security/users/:id/events` | filters | events page | — |
| `GET /api/admin/security/users/:id/restrictions` | — | restrictions | — |
| `POST /api/admin/security/users/:id/restrictions` | `{severity,reason,expiresAt?}` | restriction | `RESTRICTION_CREATED`+`ADMIN_ACTION` |
| `DELETE /api/admin/security/restrictions/:id` | reason | ok | `RESTRICTION_REMOVED`+`ADMIN_ACTION` |
| `POST /api/admin/security/users/:id/suspend` \| `/restore` \| `/revoke-license` | reason | ok | `LICENSE_*`/`RESTRICTION_*`+`ADMIN_ACTION` |
| `PATCH /api/admin/security/users/:id/limits` | `{deviceLimit?,maxConcurrentSessions?,concurrencyPolicy?}` | license | `ADMIN_ACTION` |

No routes invented beyond these; all map to a stated capability in doc 04 §9.

---

## 3. Security middleware placement

- **Edge middleware (`src/middleware.ts`)** — keep cheap & stateless: verify JWT signature/expiry, extract `sessionId`/`deviceId`/`role`, do coarse role routing and public-path handling. **No DB calls.** (Preserves current performance and edge-runtime constraints.)
- **Access Decision (`src/lib/security/access.ts` → `authorize(ctx)`)** — Node runtime, DB-authoritative. Invoked by extended `requireUser()`/`requireAdmin()` in `src/lib/auth/session.ts`. **This is the only place** device/session/restriction/license/risk are checked, so controllers stay thin (fixes logic scatter, `brief §33`).
- **Pages** (`admin/page.tsx` etc.) call `requireAdmin()` themselves — no longer relying solely on middleware (fix `02-…` H3).

---

## 4. Device service (`src/lib/security/device.ts`)

Responsibilities and signatures (conceptual):
- `identifyDevice(userId, deviceCookie, ua, ipHash)` → existing `Device` | null (lookup by `secretHash`).
- `registerPendingDevice(userId, ua, ipHash)` → mints secret, sets cookie, inserts `PENDING_VERIFICATION`.
- `verifyDevice(userId, deviceId)` → transition `PENDING→TRUSTED` (only after OTP success), enforce device limit atomically.
- `trustCheck(device)` → boolean gate used by authorize().
- `revokeDevice(userId, deviceId, actor)` → `REVOKED`, revoke its sessions, start churn cool-down, emit event.
- `replaceDevice` = revoke old + register/verify new (with cool-down honored; admin can bypass).
- `listDevices(userId)` → sanitized list (no `secretHash`).
- **Device-limit enforcement** wrapped in the §5 transaction so parallel verifications can't exceed the cap.

Legit device change (doc 04 §5) works via self-service remove (cool-down) + re-verify, or admin free-slot.

---

## 5. Session service (`src/lib/security/session.ts`) — concurrency-safe

- `createSession(userId, deviceId, remember, ctx)`:
  1. Start Mongo **transaction**.
  2. Read `License` (status, `maxConcurrentSessions`, `concurrencyPolicy`).
  3. Count `ACTIVE` sessions for `userId`.
  4. Apply policy: `DENY_NEW` → reject if at cap; `NEWEST_WINS` → revoke oldest/all to make room; `STEP_UP` → require OTP if new active session on a *different* device.
  5. Insert `Session` (partial-unique index on active-per-device is the backstop).
  6. Commit. On write-conflict/duplicate-key → retry once, else deny.
- `validateSession(sessionId)` → `ACTIVE && !expired`; throttled `lastActivityAt` update.
- `revokeSession(sessionId, reason)`, `revokeAllSessions(userId, reason)` (force-logout).
- **Token rotation:** issue a fresh JWT (new sig/iat) on privileged step-up and optionally on periodic refresh; `sessionId` stays stable, so rotation ≠ new session. No refresh-token infra needed (JWT lifetime + server session covers it).
- **Expiration:** JWT `exp` + `Session.expiresAt` + TTL purge.

**Why race-safe without Redis:** Atlas transactions + conditional counts + the partial-unique index make the "two logins see 0 active" scenario (`brief §13`) impossible; losers get a deterministic conflict.

---

## 6. Risk engine (`src/lib/security/risk.ts`) — configurable & explainable

```
Signal(s) → Rule[] (pure fns) → contributions+reasonCodes → sum=score → tier(thresholds) → recommendedAction → SecurityEvent + RiskAssessment
```
- **Signals:** newDevice, deviceCount/limit, deviceChurnRate, concurrentDistinctDeviceSessions, sessionCreationCadence, loginFailureBurst, coarseGeoChange, impossibleTravel(activeSessions), datacenterAsn, otpFailureRate. **IP low-weight; never identity; no fingerprint.**
- **Rules:** array of `{ id, weight, when(signals):bool, reasonCode }`. **Config-driven** (`rulesetVersion`, weights, thresholds in a config module/env) so tuning never edits auth code.
- **Tiers/thresholds:** configurable score bands → LOW/MEDIUM/HIGH/CRITICAL (doc 04 §7, doc 03 §8).
- **Execution:** synchronous path only does cheap checks; correlation (churn/impossible-travel) runs in the **background evaluator** (reuse `instrumentation.ts` scheduler pattern or a `SecurityEvent` consumer). Writes `RiskAssessment`; HIGH/CRITICAL may create an `AccountRestriction`.
- **Actions map** to §7 restriction / step-up.

---

## 7. Restriction service (`src/lib/security/restriction.ts`)

- `createRestriction(userId, {severity, source, reason, reasonCodes, expiresAt?}, actor)` → insert append-only row; set `License.status` accordingly (RISK_ENGINE may set up to `TEMPORARILY_RESTRICTED`; `SUSPENDED/REVOKED` admin-only). Emit event.
- **Temporary expiration:** background sweep (or lazy check in authorize()) lifts expired restrictions → recompute `License.status` → `RESTRICTION_EXPIRED` event.
- `liftRestriction(restrictionId, actor, reason)` → set `liftedAt/liftedBy`, recompute status → `RESTRICTION_REMOVED`.
- **Admin override / restore:** admin sets status back to `ACTIVE` (or `REVOKED`), always writing an `AdminAction`. **No lift/override without audit.**
- Defaults to least-severe effective action; everything reversible except admin `REVOKED` (terminal by design).

---

## 8. Admin Security Center

- **APIs:** §2.3 admin block.
- **UI (`/admin/security`):** per-customer page — license/status card; device table (label/platform/last-seen/geo/status + revoke); session table (device/created/last-active/current + revoke, logout-all); risk panel (tier + reasonCodes + history); restriction panel (create/lift, reasons, expiry); audit timeline (filterable). Limits editor (device/concurrency/policy). Every action button maps to an audited endpoint; **step-up required** for suspend/revoke/override.
- **Server authZ:** page + APIs both enforce `requireAdmin()`; not middleware-only.

---

## 9. Rate limiting (DB-backed, multi-dimension) — `src/lib/security/rate-limit.ts`

Replaces the in-memory map (`01-…` H2). Keyed by combinations of account/IP/device/endpoint over time windows, via atomic upsert counters (`RateCounter`) or window buckets:

| Operation | Suggested limit (tunable) | Keys |
|---|---|---|
| Login | e.g. 8 / 15 min | account + IP |
| OTP send/resend | e.g. 3 / 10 min, 10 / day | account (+ IP) |
| OTP verify | e.g. 5 attempts / challenge | account + challenge |
| Device registration | e.g. 5 / hour | account + IP |
| Session creation | bounded by concurrency + e.g. 20 / hour | account |
| Admin security ops | e.g. 30 / min | admin id |

Constant-time comparison for any secret checks (login timing oracle, cron secret, api-key hash).

---

## 10. Security event catalog (for §1.4 `type`)

`USER_CREATED, LICENSE_GRANTED, LICENSE_REVOKED, LOGIN_ATTEMPT, LOGIN_SUCCESS, LOGIN_FAILED, OTP_SENT, OTP_VERIFIED, OTP_FAILED, DEVICE_DETECTED, DEVICE_REGISTERED, DEVICE_VERIFIED, DEVICE_REVOKED, SESSION_CREATED, SESSION_REVOKED, CONCURRENT_SESSION_DETECTED, RISK_EVALUATED, RISK_ESCALATED, RESTRICTION_CREATED, RESTRICTION_EXPIRED, RESTRICTION_REMOVED, ADMIN_ACTION, ADMIN_OVERRIDE`. Admin-relevant subset also written to the TTL-exempt `AdminAction` audit view.

---

## 11. Migration (existing customers move safely)

The mission's hard constraint: **do not invalidate the live customer(s), no destructive migration** (`brief §16`).

**Order of operations (each reversible / behind a flag):**
1. **Additive schema only.** Create new collections + `ensureIndexes()`. Confirm/repair `User.email` & `ApiKey.prefix` unique indexes (Prisma may not have created them — `01-…` §10). No change to existing data yet.
2. **Backfill `License` for every existing USER** as `status=ACTIVE` with default `deviceLimit`/`maxConcurrentSessions`/`policy`. This encodes "lifetime access remains valid."
3. **Dual-run sessions (shadow):** start writing `Session` rows on new logins and (optionally) accept existing stateless JWTs as valid until they expire — so **currently-logged-in customers are not kicked out**. New `authorize()` treats "valid JWT without a matching server session, issued before cutover" as ALLOW+LOG during a grace window, then requires server sessions after.
4. **Device grace enrollment:** on each existing customer's next login, mint+auto-trust their current device (grandfather it, no OTP) up to the device limit; subsequent new devices follow full verification. This avoids a mass re-verification event. **New-device verification path (ADR-013, doc 07):** launch on **admin-approval enrollment** (no email dependency); switch to email OTP when a provider is approved. Email-down never auto-trusts — it falls back to admin approval; already-trusted devices always keep working.
5. **Enable enforcement gradually via flags** (§Phase 6 territory): session validation → device limit → concurrency policy → risk engine → restrictions, one at a time, observe, proceed.
6. **Rollback:** because every stage is additive and flag-gated, disabling a flag reverts to prior behavior; existing JWTs keep working through the grace window. Never delete legacy auth until enforcement is proven.

**Explicitly avoided:** password resets, forced re-login for all, deleting/rewriting `User`, or hard cutovers.

---

## 12. Open items carried into Phase 6+ (flags/rollout)
- Email provider approval (gates OTP steps 3–4 of §11 verification; until then, grandfathered devices + admin enrollment cover access).
- Cloudflare trust confirmation (gates geo signals' weight).
- Concurrency default sign-off (`maxConcurrentSessions`/policy).
- Retention windows for `SecurityEvent`/`RiskAssessment`.
- Confirm live Mongo indexes for `User.email`/`ApiKey.prefix` before relying on uniqueness.
- BFLA rate-route fix confirmed in-scope (§2.2).

---

PHASE 5 COMPLETE — WAITING FOR PHASE 6.
