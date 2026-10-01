# 02 — Authentication, Authorization & Session Deep Dive (Phase 2)

> **Status:** Phase 2 (analysis only). No code, schema, auth, API, config, or deployment was modified.
> **Builds on:** `01-existing-system-analysis.md`.
> **Method:** Line-level reading of the actual security-sensitive code. Weaknesses are documented, not fixed.

---

## 0. Reconciling the brief with reality: there is no OTP

Phase 2 asks for an OTP deep dive. **No OTP subsystem exists in this repository.** Verified again at line level:

- `src/app/api/auth/login/route.ts` reads `{ email, password, remember }` and calls `verifyPassword` (bcrypt). No code path generates, stores, sends, or verifies a one-time code.
- No email transport of any kind (`nodemailer`, SMTP, provider SDK) exists in `src/` or `package.json`.
- No routes `/api/auth/verify-otp`, `/api/auth/resend`, or `/api/auth/refresh` exist.

So section 1 documents the **actual** authentication mechanism (email + password + JWT). Where the brief asks about OTP generation/randomness/expiry/resend, the honest answer is **"not applicable — does not exist"**, and that absence is itself the finding that gates the device-verification design in Phase 3.

---

## 1. Authentication flow (actual)

### 1.1 End-to-end trace

| Step | What happens | File · function |
|---|---|---|
| 1 | Client form posts `{email, password, remember}` as JSON | `src/app/login/page.tsx` · `onSubmit` |
| 2 | Extract client IP from `x-forwarded-for` first hop (`"unknown"` fallback) | `api/auth/login/route.ts` |
| 3 | `consumeLoginAttempt(ip)` — in-memory bucket, 8 attempts / 15 min; over limit → **429** | `lib/auth/rate-limit.ts` |
| 4 | Parse/normalize body; `email.trim().toLowerCase()`; require both fields else **400** | `api/auth/login/route.ts` |
| 5 | Mongo `findOne({email})` projecting `email,name,role,passwordHash,isActive` (try/catch → **503** on DB error) | `login/route.ts` + `lib/mongo.ts` |
| 6 | `verifyPassword(password, passwordHash)` = `bcrypt.compare` | `lib/auth/password.ts` |
| 7 | If `!user || !valid` → generic **401** "Invalid email or password" | `login/route.ts` |
| 8 | If `!isActive` → **403** "This account is disabled" | `login/route.ts` |
| 9 | `createSession({id,email,name,role}, remember)` → sign JWT, set cookie | `lib/auth/session.ts` · `createSession` |
| 10 | Respond `{role,name,redirect}`; client `router.replace(redirect)` (no `router.refresh()`) | `login/route.ts`, `login/page.tsx` |

### 1.2 OTP attributes requested by the brief

| Attribute | Finding |
|---|---|
| OTP generation / randomness | **N/A** — no OTP. |
| OTP storage / expiration | **N/A** — no OTP store, no TTL. |
| OTP verification / retry limits / failed-attempt tracking | **N/A**. |
| Resend behavior | **N/A**. |
| Rate limiting | Password login only; IP-keyed in-memory (see §2/§8). |
| Email provider | **None configured** anywhere in the repo. |
| Token/session creation | JWT cookie (see §3). |

### 1.3 Password authentication quality

- **Hashing:** `bcrypt` cost **10** at login (`lib/auth/password.ts`), but the seed hashes the admin at cost **12** (`prisma/seed.ts`) — inconsistent factors.
- **Policy:** ≥8 chars, must contain a letter and a digit (`validatePassword`). Enforced on **create**, not on login.
- **User enumeration on login:** good — `!user` and `!valid` collapse to one generic 401. But timing differs: a non-existent user skips `bcrypt.compare` (fast) while a real user pays the hash cost (slow) — a **timing oracle** for account existence.
- **Enumeration on user creation:** `createAppUser` returns "A user with this email already exists." (`lib/auth/users.ts`) — but this path is admin-only, so low exposure.
- **No account lockout** per-account after repeated failures (only the shared IP bucket).
- **No MFA / second factor** anywhere, including for `SUPER_ADMIN`.

---

## 2. Token / credential architecture

### 2.1 Session JWT (`src/lib/auth/token.ts`)

| Property | Value / behavior |
|---|---|
| Type | **JWT, HS256** (symmetric), library `jose` |
| Signing key | `SESSION_SECRET` env; refuses if `< 16` chars |
| Claims | `id, email, name, role, iat, exp` — **no `jti`, no session id, no device id** |
| Lifetime | **7 days** default, **30 days** with `remember` |
| Transport/storage | httpOnly cookie `atelier_session`; `sameSite=lax`; `secure` = `COOKIE_SECURE` or `NODE_ENV==="production"`; `path=/` |
| Refresh | **None** — no refresh token, no sliding renewal |
| Rotation | **None** |
| Revocation | **None** — nothing to invalidate server-side |
| Replay protection | **None** — no `jti`, no nonce, no server record; a captured cookie is fully replayable until `exp` |
| Logout | Deletes cookie only; **token stays valid** if already captured |

**Weaknesses (token):**
- **T1 — Non-revocable, long-lived, replayable.** A leaked cookie is valid for up to 30 days with no way to kill it. Directly blocks "force logout"/"revoke session"/"suspend."
- **T2 — Identity/authorization baked into the token, never re-checked.** `role`, `email`, `name` come from the JWT on every request. If an admin demotes a user or disables them, the old token still asserts the old role/active status until expiry.
- **T3 — HS256 symmetric secret.** A single `SESSION_SECRET` signs and verifies; leakage allows forging arbitrary sessions (incl. `SUPER_ADMIN`). No key rotation/versioning (`kid`).
- **T4 — No binding.** Token is not bound to device, IP, or user-agent, so it moves freely between machines (this is exactly the sharing vector).

### 2.2 API keys (`src/lib/auth/api-keys.ts`)

| Property | Value / behavior |
|---|---|
| Format | `atl_<24 bytes base64url>` via `crypto.randomBytes` (**CSPRNG — good**) |
| Storage | `sha256(raw)` as `keyHash` + 12-char `prefix` (unique); **raw shown once** on creation |
| Lookup | `findOne({prefix})` then compare `keyHash` |
| Checks | rejects if `revokedAt`, or user `!isActive`, or `role!=="USER"`; updates `lastUsedAt` (fire-and-forget) |
| Scope | USER-only; blocked on `/api/admin*` by middleware |

**Weaknesses (API keys):**
- **K1 — Non-constant-time hash compare** (`key.keyHash !== hashKey(raw)`), a timing side channel.
- **K2 — Unsalted sha256** (acceptable for a 192-bit random secret, but no defense-in-depth if the DB leaks and keys were low-entropy — here entropy is fine).
- **K3 — No key expiry, no per-key rate limit, no usage audit** beyond `lastUsedAt`.

---

## 3. Session architecture (actual)

- **Creation:** at login only, via `createSession` → signed JWT in cookie. **No server-side session row is created.**
- **Identification:** a session *is* the JWT; there is no session identifier the server can reference, list, or revoke.
- **Server-side store:** **none.** No `Session` collection. Session state lives entirely in the client cookie.
- **Multiple sessions:** unlimited and untracked. The same account can hold valid cookies on any number of devices/browsers simultaneously.
- **Concurrent-session tracking:** **none.** There is no counter, no "active sessions," nothing to enforce `maxConcurrentSessions`.
- **Logout (`api/auth/logout/route.ts`):** `clearSession()` deletes the cookie on the responding client only. Other devices and any copied token remain authenticated.
- **Expiry handling:** purely cryptographic (`exp`). `jwtVerify` throws on expiry → `readSessionToken` returns `null` → treated as logged-out. No server cleanup needed because there is no store.

**Weaknesses (session):**
- **S1 — No device or session identity** → the target model's device limit and per-session controls have no foundation.
- **S2 — No concurrency limit or even visibility.**
- **S3 — Logout is cosmetic** against a captured token.
- **S4 — In-memory rate-limit + per-process cron guard** work only under the single-instance PM2 fork deployment (Phase 1 H2). Any horizontal scale-out silently breaks them; session/concurrency state must be DB-backed when introduced (Atlas replica set supports transactions).

---

## 4. Authorization architecture (actual)

Two enforcement layers; middleware is primary, route checks are defense-in-depth.

### 4.1 Decision chain

```
Authenticated?   → middleware verifies JWT cookie (or allows API-key / cron paths)
       ↓
Correct role?    → middleware confines SUPER_ADMIN to /admin*, blocks USER from /admin*
       ↓
Product access?  → NOT CHECKED — no license/entitlement concept exists
       ↓
Resource-level?  → services always scope queries by the session userId (ownership), never by request input
```

### 4.2 Middleware (`src/middleware.ts`)

- Skips `_next`, `favicon`, `tessdata`, and any path with a file extension (static).
- Public: `/login`, `/api/auth/login`. Logged-in user hitting `/login` → role home.
- **Cron bypass:** unauthenticated `Bearer CRON_SECRET` allowed **only** for `/api/gold-rate/update` and `/api/fx-rates/update`.
- **API-key bypass:** `x-api-key`/`Bearer atl_…` allowed for `/api/*` except `/api/admin*`; the real key validation happens later in the route (`requireUser`).
- No session → `/api/*` gets **401 JSON**; pages redirect to `/login?next=…`.
- `SUPER_ADMIN` allowed only on `/`, `/admin*`, `/api/admin*`, `/api/auth*`; else redirected to `/admin` (or 403 for API).
- `USER` on `/admin*`/`/api/admin*` → **403** (API) or redirect `/dashboard` (page).

### 4.3 Route guards (`src/lib/auth/session.ts`)

- `requireUser()` — session role `USER`, else API-key session, else `AuthError(401/403)`.
- `requireAdmin()` — session role `SUPER_ADMIN`, else `AuthError`.
- `AuthError` carries an HTTP status; routes translate it to a JSON response.

**Weaknesses (authorization):**
- **A1 — No product-access/license layer.** Authorization = authenticated + role + ownership. "Has this customer got access right now?" is only ever answered at login-time via `isActive`, never per request (ties to T2).
- **A2 — Middleware is a single point of authorization for pages.** `admin/page.tsx` has no `requireAdmin()` of its own (Phase 1 H3); a matcher regression exposes the roster.
- **A3 — Runtime authorization trusts token claims** rather than current DB state.

---

## 5. API / bypass analysis (code-level, not exploited)

### 5.1 Frontend restrictions vs backend enforcement

The login page and app shell are **UI only**; all real gating is server-side (middleware + `requireUser`/`requireAdmin`). So hiding a button is never the control — good. However, backend enforcement has specific gaps below.

### 5.2 Endpoint-by-endpoint

| Endpoint | AuthN | AuthZ | IDOR/BOLA | Notes |
|---|---|---|---|---|
| `POST /api/auth/login` | public | n/a | n/a | enumeration timing (§1.3) |
| `POST /api/auth/logout` | none | n/a | n/a | cosmetic logout (§3) |
| `/api/admin/users` (GET/POST/PATCH/DELETE) | `requireAdmin` | role | **id from body**, but admin-only → acceptable | DELETE cascades user data |
| `/api/admin/users/[id]/keys` (GET/POST/PATCH) | `requireAdmin` | role | id from path, admin-only | issues raw key once |
| `GET /api/dashboard` | `requireUser` | ownership | none — uses `session.id` | |
| `GET /api/history` | `requireUser` | ownership | none | |
| `GET/POST /api/products` | `requireUser` | ownership | none — `userId` never from body | |
| `POST /api/ocr/process` | `requireUser` **after body parse** | ownership | none | **auth ordering**: multipart + ~10MB alloc + distinct 400s before the 401 → unauth DoS/oracle |
| `GET/PUT /api/settings/pricing-defaults` | `requireUser`; PUT auth **after** parse | ownership (own doc) | none | body is raw `as PricingDefaults` cast, unvalidated numerics |
| `POST /api/gold-rate/update` | cron secret **or** `requireUser` | **none beyond "is a USER"** | **cross-tenant write** | any USER rewrites **every** tenant's gold rate |
| `POST /api/silver-rate/update` | cron secret **or** `requireUser` | same | **cross-tenant write** | same; never scheduled |
| `POST /api/fx-rates/update` | cron secret **or** `requireUser` | same | **global write + outbound fetch** | any USER triggers third-party call + global snapshot write |
| `GET /api/fx-rates/current` | `requireUser` | none (global read) | n/a | shared resource |

### 5.3 Bypass findings

- **B1 — Broadest issue: cross-tenant function-level authorization failure (BFLA).** `gold-rate/update`, `silver-rate/update`, `fx-rates/update` are reachable by **any** logged-in USER (or API-key holder) and mutate **all tenants'** data / global state. This is an authorization defect, not an account-sharing one, but it is CRITICAL on its own. (`services/settings.ts` `patchGold24kRateOnAllDefaults` / `patchSilverRateOnAllDefaults`; `services/fx-rates.ts` `updateDailyRates`.)
- **B2 — No classic user-controlled IDOR** on USER data routes: every user-scoped service takes `userId` from the session, never from request body/query. Tenant isolation holds at the route layer.
- **B3 — Admin endpoints not exposed to USERs** (middleware 403 + `requireAdmin`), but the `/admin` **page** leans solely on middleware (H3).
- **B4 — Auth-after-work ordering** (`ocr/process`, `settings PUT`) lets unauthenticated callers force parsing/allocation and read distinct error messages before the 401.
- **B5 — Cron secret comparison is non-constant-time** (`token === secret`, three duplicated copies).

---

## 6. Admin security (actual)

- **Roles/permissions:** binary — `SUPER_ADMIN` vs `USER`. No granular permissions, no separate "security admin" scope.
- **Admin auth:** identical password+JWT flow as users; **no MFA, no step-up re-authentication** for sensitive actions (create/disable/delete user, issue/revoke keys).
- **Session behavior:** same stateless 7/30-day JWT; an admin cookie cannot be revoked either.
- **Sensitive actions:** user create/disable/delete (with data cascade), API-key issue/revoke — all gated only by `requireAdmin()`.
- **Audit logging:** **none.** No record of who created/disabled/deleted a user, when, or from where. No admin-action trail at all.
- **Bootstrap:** only `prisma/seed.ts` mints the admin, using `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` with **hard-coded fallbacks** if env is unset.

**Weaknesses (admin):**
- **AD1 — No admin audit trail** (required foundation for the whole project).
- **AD2 — No MFA / step-up** for high-impact actions; admin JWT non-revocable (compromise persists up to 30 days).
- **AD3 — Seed fallback credentials** risk a predictable admin if env not set.

---

## 7. Consolidated security weaknesses (Phase 2)

| ID | Severity | Weakness | Location |
|---|---|---|---|
| T1 | CRITICAL | JWT non-revocable, long-lived, replayable; logout cosmetic | `token.ts`, `session.ts`, `logout` |
| B1 | CRITICAL | Cross-tenant/global writes reachable by any USER (BFLA) | rate/fx update routes, `services/settings.ts` |
| S1/S2 | HIGH | No device or session identity; no concurrency tracking/limit | `token.ts` (no jti/device), whole session layer |
| T2/A1/A3 | HIGH | Authorization trusts token claims; no per-request `isActive`/access re-check; no license concept | `token.ts`, `session.ts`, all routes |
| H2/S4 | HIGH | In-memory rate limit + per-process cron guard break on scale-out | `rate-limit.ts`, `instrumentation.ts` |
| B4 | HIGH | Auth check runs after untrusted parse/allocation | `ocr/process`, `settings PUT` |
| AD1 | MEDIUM | No admin/security audit logging anywhere | admin routes, users lib |
| AD2 | MEDIUM | No admin MFA/step-up; admin token non-revocable | auth layer |
| M2 | MEDIUM | IP-only login rate limit; no per-account/per-endpoint limits | `rate-limit.ts`, `login` |
| T3 | MEDIUM | HS256 single secret, no key rotation/`kid` | `token.ts` |
| M3/B5/K1 | MEDIUM | Non-constant-time secret/hash comparisons | `gold-rate/update`, `api-keys.ts` |
| M4 | MEDIUM | Unvalidated request bodies (`as` casts) | `settings PUT` |
| §1.3 | LOW | Login timing oracle for account existence | `login/route.ts` |
| T4 | LOW→context | Token not bound to device/UA/IP (the sharing vector) | `token.ts` |
| K3/AD3/L1-L3 | LOW | Key expiry/audit; seed fallback creds; plain-HTTP origin; Mongo `tlsAllowInvalidCertificates` | various |

---

## 8. Files / functions involved (reference)

| Area | File · symbol |
|---|---|
| JWT sign/verify | `src/lib/auth/token.ts` · `signSession`, `readSessionToken`, `getSecret` |
| Session cookie + guards | `src/lib/auth/session.ts` · `getSession`, `createSession`, `clearSession`, `requireUser`, `requireAdmin`, `AuthError`, `shouldUseSecureCookie` |
| Password | `src/lib/auth/password.ts` · `hashPassword`, `verifyPassword`, `validatePassword` |
| Login rate limit | `src/lib/auth/rate-limit.ts` · `consumeLoginAttempt` |
| API keys | `src/lib/auth/api-keys.ts` · `generateApiKey`, `resolveApiKeyUser`, `hashKey`, `getApiKeySession` |
| Login route | `src/app/api/auth/login/route.ts` · `POST` |
| Logout route | `src/app/api/auth/logout/route.ts` · `POST` |
| Middleware | `src/middleware.ts` · `middleware`, `isPublic` |
| Admin routes | `src/app/api/admin/users/route.ts`, `.../[id]/keys/route.ts` |
| Admin user CRUD | `src/lib/auth/users.ts` · `createAppUser`, `setUserActive`, `deleteAppUser`, `listAppUsers`, `findUserByEmail` |
| Cross-tenant writes | `src/lib/services/settings.ts` · `patchGold24kRateOnAllDefaults`, `patchSilverRateOnAllDefaults` |
| Login UI | `src/app/login/page.tsx` |
| Root gating | `src/app/page.tsx`, `src/app/layout.tsx` |

---

## 9. Areas requiring future architectural attention (input to Phase 3+, not designs)

1. **Session model must become server-tracked.** Every target requirement (revoke, force-logout, suspend, concurrency limit, device binding) depends on a server-side session record keyed to a device. This is the load-bearing decision. Options to weigh in Phase 3: JWT-carrying-`sessionId` validated against Mongo vs. opaque session tokens; how middleware (edge runtime) validates without a per-request DB round-trip on every asset.
2. **Per-request authorization must consult current state,** not just token claims — so disable/suspend/revoke take effect immediately.
3. **Device identity** needs a concrete, server-issued model for a browser-only product (no native client, no reliable fingerprint). Reconcile "device limit" UX with a cookie-bound server credential.
4. **A verification channel does not exist.** Device verification / step-up assumes OTP; we must decide to build email OTP (needs an email provider) or use an alternative (admin approval, password re-entry).
5. **Audit logging is greenfield** and is a prerequisite for admin security controls and abuse detection.
6. **State that must survive horizontal scale** (sessions, rate limits, concurrency counters, locks) must be DB-backed; do not extend the in-memory approach.
7. **The BFLA cross-tenant write routes (B1)** should be decided in/out of scope — they are a live authorization defect independent of account sharing.
8. **Constant-time comparisons, body validation, auth-ordering, HS256→key-rotation** are hardening items to fold into whichever routes get touched.

---

PHASE 2 COMPLETE — WAITING FOR PHASE 3.
