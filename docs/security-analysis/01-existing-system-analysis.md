# 01 — Existing System Analysis (Phase 1)

> **Status:** Phase 1 (analysis only). No code, schema, auth, API, config, or deployment was modified to produce this document.
> **Scope:** Understand the existing application deeply enough to safely design the account-sharing / access-control security system in later phases.
> **Method:** Findings below are derived from reading the actual repository source, not assumptions. File paths are given so every claim can be verified.

---

## 0. Headline correction (read this first)

The project brief states current authentication is **"email + OTP."** **This is not what the codebase does.**

The actual implementation is **email + password with a stateless JWT session cookie**. Verified facts:

- Login (`src/app/api/auth/login/route.ts`) accepts `{ email, password, remember }`, verifies a **bcrypt** `passwordHash`, and issues a signed **JWT** (`jose`, HS256) in an `httpOnly` cookie named `atelier_session`.
- There is **no OTP, no email sending, no `nodemailer`, no magic link, no verification code** anywhere in `src/`. Repo-wide search for these primitives returned nothing.
- There is **no server-side session store**, **no device model**, **no license/entitlement model**, **no refresh token**, and **no Redis**.

This matters because the target design leans on "the existing email OTP system" for device verification. That capability **does not exist yet** and will have to be designed and built, or replaced with another verification mechanism. Flagged as an open question (§14).

---

## 1. Repository structure

```
d:\atelier
├─ src/
│  ├─ middleware.ts                 # Edge middleware — the primary auth gate
│  ├─ instrumentation.ts            # Startup hook — registers node-cron jobs in-process
│  ├─ app/
│  │  ├─ layout.tsx                 # Root layout; reads session for nav chrome (does NOT gate)
│  │  ├─ page.tsx                   # Root route; redirects by role
│  │  ├─ login/page.tsx             # Client login form (fetch → /api/auth/login)
│  │  ├─ admin/page.tsx             # Super-admin users page (NO server-side auth check)
│  │  ├─ dashboard/ history/ pricing/  # USER-facing product pages
│  │  └─ api/
│  │     ├─ auth/login/route.ts     # Password login → JWT cookie
│  │     ├─ auth/logout/route.ts    # Clears cookie
│  │     ├─ admin/users/route.ts    # Admin CRUD on USER accounts
│  │     ├─ admin/users/[id]/keys/route.ts  # Admin issues/revokes API keys for a user
│  │     ├─ dashboard/route.ts      # USER dashboard stats
│  │     ├─ history/route.ts        # USER calculation history
│  │     ├─ products/route.ts       # USER products list/create
│  │     ├─ ocr/process/route.ts    # USER OCR image processing
│  │     ├─ settings/pricing-defaults/route.ts   # USER pricing defaults get/put
│  │     ├─ gold-rate/update/route.ts    # Rate refresh (USER or cron)
│  │     ├─ silver-rate/update/route.ts  # Rate refresh (USER or cron) — never scheduled
│  │     ├─ fx-rates/update/route.ts     # FX refresh (USER or cron)
│  │     └─ fx-rates/current/route.ts    # FX snapshot read
│  ├─ lib/
│  │  ├─ auth/
│  │  │  ├─ token.ts                # JWT sign/verify, cookie name, lifetimes
│  │  │  ├─ session.ts              # getSession/createSession/requireUser/requireAdmin
│  │  │  ├─ password.ts             # bcrypt hash/verify + password policy
│  │  │  ├─ rate-limit.ts           # In-memory login rate limiter (per-process Map)
│  │  │  ├─ users.ts                # Admin user CRUD (raw mongodb driver)
│  │  │  └─ api-keys.ts             # API-key issue/verify/revoke (sha256)
│  │  ├─ mongo.ts                   # Raw mongodb driver singleton (runtime data path)
│  │  ├─ db.ts                      # PrismaClient singleton (NOT used at runtime)
│  │  └─ services/                  # products, settings, ocr, gold/silver/fx rate logic
│  ├─ components/                   # UI (incl. components/admin/users-panel.tsx)
│  └─ types/
├─ prisma/
│  ├─ schema.prisma                 # Data model definition (source of truth for shape)
│  └─ seed.ts                       # Seeds lookups + one SUPER_ADMIN
├─ scripts/                         # build-deploy, tessdata download, fx fetch
├─ deploy/atelier-vps/             # Prebuilt standalone bundle for VPS (gitignored)
├─ public/                          # Static assets
├─ next.config.ts                   # output: "standalone"
├─ package.json
├─ README.md, AGENTS.md, CLAUDE.md  # AGENTS.md = generated Next block; CLAUDE.md = pointer
└─ (no docs/ directory before this file)
```

No pre-existing architecture or security documentation exists. `README.md` is setup instructions; `AGENTS.md` is the auto-generated Next.js agent block; `CLAUDE.md` is a one-line `@AGENTS.md` pointer.

---

## 2. Technology stack (actual)

| Layer | Technology | Evidence |
|---|---|---|
| Framework | Next.js **16.3.5** (App Router) | `package.json`, `next.config.ts` |
| UI runtime | React **19.2.8**, TypeScript 5 | `package.json` |
| Styling | Tailwind CSS 4, Radix UI, lucide-react | `package.json` |
| Database | **MongoDB Atlas** (`mongodb+srv`, replica set) | `.env.production` DATABASE_URL scheme confirmed |
| Data access (runtime) | **`mongodb` driver v7** directly | `src/lib/mongo.ts`, all services |
| ORM | **Prisma 6.19** — schema + seed only, **not used at runtime** | no `prisma.` calls in `src/` |
| AuthN | Email + **bcrypt** password | `src/lib/auth/password.ts`, `login/route.ts` |
| Session | **Stateless JWT** (`jose`, HS256) in httpOnly cookie | `src/lib/auth/token.ts` |
| API auth (machine) | Opaque API keys `atl_…`, sha256-hashed | `src/lib/auth/api-keys.ts` |
| Scheduling | `node-cron` in-process | `src/instrumentation.ts` |
| OCR | `tesseract.js` (local traineddata) | services/ocr, `next.config.ts` |
| Deployment | Next **standalone** Node server, **PM2 fork (single instance)**, plain HTTP, Cloudflare assumed for TLS | `deploy/atelier-vps/*`, `scripts/build-deploy.mjs` |
| Caching | Next `unstable_cache` for pricing defaults | `src/lib/services/settings.ts` |
| Queues / Redis | **None** | absent |
| Tests | Vitest — **no auth/session/route tests** | `*.test.ts` under excel/fx/services only |

**Dual-database-layer note:** Prisma defines the schema and seeds data; the running app talks to Mongo through the raw driver. Prisma model decorators like `@unique` therefore describe *intended* constraints but are **not necessarily enforced as Mongo indexes** unless `prisma db push` created them. This gap is relevant for later phases (uniqueness/atomicity guarantees).

---

## 3. Architecture

```
Browser (cookie: atelier_session JWT)  |  API client (x-api-key / Bearer atl_…)  |  Cron (Bearer CRON_SECRET, loopback)
        │
        ▼
Next.js Edge Middleware  (src/middleware.ts)  ── primary gate: authn + role routing
        │
        ▼
Route Handlers (src/app/api/**/route.ts)  ── per-route requireUser()/requireAdmin() (defence in depth, inconsistent — see §12)
        │
        ▼
Services (src/lib/services/**)  ── business logic; take userId as a parameter, do NOT read the session
        │
        ▼
MongoDB Atlas (raw mongodb driver, src/lib/mongo.ts)
```

Server Components (e.g. `admin/page.tsx`, `dashboard/page.tsx`) call services/lib directly during SSR rather than going through the API layer.

Module responsibilities:
- **middleware.ts** — authenticates the JWT cookie, routes by role, allows API-key and cron paths, blocks USER from `/admin*`.
- **lib/auth** — token, session, password, rate-limit, user CRUD, API keys.
- **lib/services** — products, pricing settings, OCR, gold/silver/fx rates. All user-scoped services receive `userId` as an argument; tenant isolation is enforced only at the route layer.
- **instrumentation.ts** — schedules daily gold (11:15 IST) and FX (11:20 IST) refresh crons in-process.

---

## 4. User roles (actual)

Defined in `prisma/schema.prisma` as enum `UserRole`:

- **`SUPER_ADMIN`** — the admin. Created only by the seed script (`prisma/seed.ts`). Manages USER accounts and API keys. Routed to `/admin`.
- **`USER`** — the customer/licensee. Created by an admin. Owns jewellery data. Routed to `/dashboard`.

There is a **single admin tier** (no separate "staff"). There is **no "customer" entity distinct from `USER`** — the licensed customer *is* a `User` row with `role = USER`.

---

## 5. Customer (USER) lifecycle

| Stage | How it works | Code |
|---|---|---|
| Create | Admin `POST /api/admin/users` → `createAppUser({name,email,password})`. Validates email/password, checks email uniqueness via `findOne`, inserts `User{ role:"USER", isActive:true, passwordHash }`. | `api/admin/users/route.ts`, `lib/auth/users.ts` |
| Grant access | **Implicit** — a `USER` row with `isActive:true` *is* the grant. There is no license/entitlement/expiry object. | `lib/auth/users.ts` |
| "Lifetime" representation | Represented only by the account existing and `isActive:true`. No expiry field exists, so access is inherently perpetual. | schema |
| Access check | Login verifies password + `isActive`. Thereafter the JWT alone authorizes requests; **`isActive` is not re-checked per request.** | `login/route.ts`, `middleware.ts` |
| Disable | Admin `PATCH /api/admin/users` → `setUserActive(id,false)`. **Only blocks future logins and API keys** — an already-issued JWT keeps working until expiry (7/30 days). | `lib/auth/users.ts` |
| Delete | Admin `DELETE /api/admin/users` → `deleteAppUser(id)` cascades: deletes the user's products, variations, calculations, calc items, OCR imports/extractions, settings, and API keys. | `lib/auth/users.ts` |

**Key gap for the project objective:** because sessions are stateless JWTs, "revoke access now," "force logout," and "suspend" are **not achievable today** without new server-side session state. (§12)

---

## 6. Authentication flow (actual — password, not OTP)

```
User submits email + password (+ remember)   [src/app/login/page.tsx]
        │  fetch POST /api/auth/login
        ▼
Rate-limit by IP (in-memory Map, 8 / 15 min)  [lib/auth/rate-limit.ts]
        ▼
Mongo findOne({email}) → user row              [login/route.ts + lib/mongo.ts]
        ▼
bcrypt.compare(password, passwordHash)         [lib/auth/password.ts]
        ▼
Reject if !user || !valid (generic 401)  |  Reject if !isActive (403)
        ▼
signSession({id,email,name,role}, days)  → JWT (HS256, exp 7d or 30d "remember")   [lib/auth/token.ts]
        ▼
Set httpOnly cookie atelier_session (sameSite=lax; secure per COOKIE_SECURE/NODE_ENV; path=/)   [lib/auth/session.ts]
        ▼
Response { role, name, redirect }; client router.replace(redirect)   [login/page.tsx]
```

Files involved: `login/page.tsx`, `api/auth/login/route.ts`, `lib/auth/rate-limit.ts`, `lib/auth/password.ts`, `lib/auth/token.ts`, `lib/auth/session.ts`, `lib/mongo.ts`.

There is **no** OTP generation, storage, delivery, or verification step. The `POST /api/auth/verify-otp` / `POST /api/auth/refresh` routes named in the brief **do not exist**.

**Machine authentication (parallel path):** API keys `atl_<base64url>`; only the sha256 `keyHash` + a 12-char `prefix` are stored. `resolveApiKeyUser` looks up by prefix, compares hash, checks `user.isActive` and `role==="USER"`, and updates `lastUsedAt`. API keys are USER-only (rejected on `/api/admin`).

---

## 7. Session architecture (actual)

- **Type:** Stateless **JWT** (`jose`, HS256), signed with `SESSION_SECRET` (must be ≥16 chars, enforced in `token.ts`).
- **Claims:** `id`, `email`, `name`, `role`, `iat`, `exp`. No session id, no device id, no jti.
- **Storage:** single httpOnly cookie `atelier_session`. Nothing in localStorage/sessionStorage (verified — login page persists no tokens).
- **Lifetime:** 7 days default, 30 days with "remember" (`SESSION_DAYS`/`REMEMBER_DAYS`).
- **Refresh:** none. No refresh token, no sliding renewal.
- **Logout:** `POST /api/auth/logout` deletes the cookie client-side. **The JWT remains cryptographically valid** until expiry — a captured token still works after "logout."
- **Revocation:** **impossible today.** No server-side record to invalidate. Disabling/deleting a user does not kill live JWTs.
- **Multi-device / concurrency:** completely unconstrained. The same account can be logged in from unlimited devices/browsers simultaneously; nothing tracks or limits it.
- **Cookie security:** `sameSite=lax`, `httpOnly=true`, `secure` controlled by `COOKIE_SECURE` env (can be disabled for plain-HTTP access — relevant since deployment is HTTP behind Cloudflare).

This is the single most important structural finding for the account-sharing objective: **the current session model has no notion of device, no concurrency limit, and no revocation** — exactly the three things the target model requires.

---

## 8. Authorization flow (actual)

Enforcement happens in two places, with the **edge middleware as the primary gate**:

**`src/middleware.ts`** (runs on nearly all paths; matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and file-extension assets):
- Public allow-list: `/login`, `/api/auth/login`.
- Reads/verifies the JWT. If a logged-in user hits `/login`, redirects to role home.
- Cron bypass: unauthenticated `Bearer CRON_SECRET` allowed **only** for `/api/gold-rate/update` and `/api/fx-rates/update`.
- API-key bypass: `x-api-key`/`Bearer atl_…` allowed for `/api/*` except `/api/admin*` (actual key validation happens later in the route via `requireUser`).
- No session → API paths get `401 JSON`; page paths redirect to `/login?next=…`.
- `SUPER_ADMIN` is confined to `/`, `/admin*`, `/api/admin*`, `/api/auth*`.
- `USER` hitting `/admin*` or `/api/admin*` → `403` (API) or redirect to `/dashboard` (page).

**Route-level checks (`lib/auth/session.ts`)** — defence in depth:
- `requireUser()` — session role `USER`, else falls back to API-key session, else throws `AuthError(401/403)`.
- `requireAdmin()` — requires session role `SUPER_ADMIN`, else `AuthError`.

Authorization is **role + ownership** only. There is **no** license check, no device check, no session-validity check, no account-status re-check, and no risk evaluation — because none of those subsystems exist. Ownership is enforced by services always scoping queries to the `userId` passed in by the route (from the session), never from request input.

---

## 9. Admin flow (actual)

```
Admin logs in (same /api/auth/login, role SUPER_ADMIN) → JWT → redirect /admin
        ▼
/admin page (admin/page.tsx) server-renders listAppUsers() and mounts <AdminUsersPanel>
        ▼
Admin actions via /api/admin/users:
   GET    → list USER accounts
   POST   → create USER (name,email,password)         [createAppUser]
   PATCH  → enable/disable (isActive)                 [setUserActive]
   DELETE → delete USER + all owned data (cascade)    [deleteAppUser]
        ▼
API keys per user via /api/admin/users/[id]/keys:
   GET → list | POST → issue (returns raw token once) | PATCH → revoke
```

Admin creation is **out-of-band**: only `prisma/seed.ts` creates the `SUPER_ADMIN`, using `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` env (defaults `admin@atelier.local` / a hard-coded fallback password if unset).

Every admin route calls `requireAdmin()` **except the `/admin` page component itself**, which relies solely on middleware (§12).

---

## 10. Database model (actual)

Source of truth: `prisma/schema.prisma` (MongoDB). Security-relevant models:

**`User`**
- `id`(ObjectId), `email`(**@unique**), `passwordHash`, `name`, `role`(SUPER_ADMIN|USER), `isActive`(bool, default true), `createdAt`, `updatedAt`
- Relations: `AppSetting[]`, `OcrImport[]`, `JewelleryProduct[]`, `PricingCalculation[]`, `ApiKey[]`

**`ApiKey`**
- `id`, `userId`(→User, cascade), `name`, `prefix`(**@unique**), `keyHash`(sha256), `lastUsedAt?`, `revokedAt?`, `createdAt`; index on `userId`

**Domain models** (`AppSetting` [unique userId+key], `OcrImport`, `OcrExtractedData`, `JewelleryProduct`, `JewelleryVariation`, `PricingCalculation`, `PricingCalculationItem`) — all owned by a `User` via `userId`, cascade-delete on user removal.

Entities the target model needs that **do not exist**: `Session`, `Device`, `License`/`Entitlement`, `SecurityEvent`/audit log, `RiskAssessment`, `AccountRestriction`, `AdminAction`.

Relationships:
```
User (1) ──< ApiKey
User (1) ──< AppSetting / OcrImport / JewelleryProduct / PricingCalculation
JewelleryProduct (1) ──< JewelleryVariation
PricingCalculation (1) ──< PricingCalculationItem
```

**Uniqueness caveat:** `@unique` on `User.email` and `ApiKey.prefix` is declared in Prisma; whether a corresponding Mongo unique index actually exists depends on `prisma db push` having been run against the live cluster. Must be confirmed before relying on it for concurrency safety (§14).

---

## 11. Relevant APIs (inventory)

| Route | Methods | AuthZ in handler | Mutates shared/global state? | Notes |
|---|---|---|---|---|
| `/api/auth/login` | POST | public | no | password → JWT; in-memory IP rate limit |
| `/api/auth/logout` | POST | none needed | no | clears cookie only; JWT stays valid |
| `/api/admin/users` | GET/POST/PATCH/DELETE | `requireAdmin()` | no | user CRUD + cascade delete |
| `/api/admin/users/[id]/keys` | GET/POST/PATCH | `requireAdmin()` | no | API key issue/revoke |
| `/api/dashboard` | GET | `requireUser()` | no | own data only |
| `/api/history` | GET | `requireUser()` | no | own data only |
| `/api/products` | GET/POST | `requireUser()` | no | own data; userId from session |
| `/api/ocr/process` | POST | `requireUser()` **after** body parse | no | auth ordering issue (§12) |
| `/api/settings/pricing-defaults` | GET/PUT | `requireUser()`; PUT auth **after** body parse | no (own doc) | unvalidated `as PricingDefaults` cast |
| `/api/gold-rate/update` | POST | cron secret **or** `requireUser()` | **YES — all tenants** | any USER can rewrite every tenant's gold rate |
| `/api/silver-rate/update` | POST | cron secret **or** `requireUser()` | **YES — all tenants** | same; never scheduled by cron |
| `/api/fx-rates/update` | POST | cron secret **or** `requireUser()` | **YES — global FX snapshot** | any USER triggers external fetch + global write |
| `/api/fx-rates/current` | GET | `requireUser()` | no | reads global snapshot |

Routes named in the brief that **do not exist**: `/user`, `/profile`, `/content`, `/license`, `/verify-otp`, `/refresh`, `/device`.

---

## 12. Security observations (documented, not fixed)

Severity is a first pass to guide later phases; the full threat model is Phase 2 work.

**CRITICAL**
- **C1 — No session revocation / no live-session control.** Stateless JWTs mean disable, delete, logout, and "force logout" do not invalidate an active token until it expires (7–30 days). Directly blocks the target requirements (revoke sessions, suspend, force logout). `token.ts`, `session.ts`, `logout/route.ts`.
- **C2 — Cross-tenant shared-state write via low-privilege routes.** Any logged-in `USER` (or API-key holder) can call `/api/gold-rate/update` or `/api/silver-rate/update`, which loop over **every** tenant's `AppSetting` and overwrite their gold/silver rate (`patchGold24kRateOnAllDefaults` / `patchSilverRateOnAllDefaults`), and `/api/fx-rates/update` writes a global snapshot + triggers an outbound third-party fetch. No admin gate, no rate limit. `services/settings.ts`, the three update routes.

**HIGH**
- **H1 — No device model and no concurrency limit.** Unlimited simultaneous logins per account from any number of devices — the core enabler of account sharing. Nothing to build on yet.
- **H2 — In-memory state won't survive scale-out.** Login rate limiter is a per-process `Map` (`rate-limit.ts`) and the cron guard is a per-process `globalThis` flag. Both work only because deployment is single-instance **by convention**; `pm2 -i` or a second node silently breaks rate limiting and duplicates cron writes.
- **H3 — `/admin` page has no server-side authZ.** `admin/page.tsx` calls `listAppUsers()` directly with no `requireAdmin()`/`getSession()`; authorization rests entirely on middleware. Any matcher regression exposes the full user roster.
- **H4 — Auth checks run after untrusted work.** `ocr/process` parses multipart and allocates up to ~10MB **before** `requireUser()`, and returns distinct 400 messages — an unauthenticated DoS/oracle. `settings/pricing-defaults` PUT parses/validates the body before auth. `ocr/process/route.ts`, `settings/pricing-defaults/route.ts`.

**MEDIUM**
- **M1 — No audit logging.** No security events are recorded (login success/fail, admin actions, key issue/revoke). Required foundation for the whole project.
- **M2 — IP-only login rate limiting, and only on login.** Keyed solely on `x-forwarded-for` first hop (spoofable if not fronted correctly); no per-account/per-endpoint limits; other sensitive routes have none. `rate-limit.ts`, `login/route.ts`.
- **M3 — Non-constant-time secret comparisons.** `CRON_SECRET` compared with `===`; API-key hash compared with `!==` on hex string. Timing-side-channel exposure. `gold-rate/update/route.ts`, `api-keys.ts`.
- **M4 — Unvalidated request bodies.** `PricingDefaults` accepted via raw `as` cast with only 3 null-checks; no numeric-bound/shape validation.
- **M5 — Seed admin fallback secrets.** `prisma/seed.ts` falls back to a hard-coded admin password and `admin@atelier.local` if env unset. `CRON_SECRET` is undocumented in `.env.production.example`, so a fresh deploy silently ships with crons disabled.

**LOW / INFO**
- **L1 — Plain-HTTP origin, `HOSTNAME=0.0.0.0`, `poweredByHeader:true`.** App directly reachable on `:3000` unless a host firewall restricts to Cloudflare; TLS is external and only referenced in prose (`deploy/atelier-vps/START.md`, generated `server.js`).
- **L2 — Deploy bundle carries real `.env.production`.** `build-deploy.mjs` copies live secrets into `deploy/atelier-vps/` (gitignored, but travels with any copy of that folder).
- **L3 — Mongo TLS `tlsAllowInvalidCertificates: true`.** Accepts invalid certs to Atlas (`mongo.ts`).
- **L4 — No auth/session/route tests.** Vitest covers only excel/fx/pricing parsing; zero coverage of the security-critical paths we're about to change.

---

## 13. Important files (reference map)

| Concern | File |
|---|---|
| Primary auth gate | `src/middleware.ts` |
| JWT sign/verify, cookie, lifetimes | `src/lib/auth/token.ts` |
| Session helpers, requireUser/requireAdmin | `src/lib/auth/session.ts` |
| Password hashing + policy | `src/lib/auth/password.ts` |
| Login rate limiter (in-memory) | `src/lib/auth/rate-limit.ts` |
| Admin user CRUD | `src/lib/auth/users.ts` |
| API keys | `src/lib/auth/api-keys.ts` |
| Mongo driver singleton (runtime) | `src/lib/mongo.ts` |
| Prisma client (unused at runtime) | `src/lib/db.ts` |
| Schema (shape source of truth) | `prisma/schema.prisma` |
| Seed + admin bootstrap | `prisma/seed.ts` |
| Login route | `src/app/api/auth/login/route.ts` |
| Logout route | `src/app/api/auth/logout/route.ts` |
| Admin routes | `src/app/api/admin/users/route.ts`, `.../[id]/keys/route.ts` |
| Admin page (no server authZ) | `src/app/admin/page.tsx` |
| Root gating | `src/app/page.tsx`, `src/app/layout.tsx` |
| Cross-tenant rate writes | `src/lib/services/settings.ts` + gold/silver/fx update routes |
| In-process cron | `src/instrumentation.ts` |
| Deployment | `scripts/build-deploy.mjs`, `deploy/atelier-vps/server.js`, `START.md` |

---

## 14. Open questions (blocking or shaping later phases)

1. **Verification channel (blocking device design).** The brief assumes email OTP, which does not exist. For device verification, do we (a) build a new email OTP/verification channel (requires choosing an email provider — none is configured), or (b) use a different mechanism (e.g. admin-approved device enrollment, or re-password confirmation)? This gates the entire device-trust design.
2. **Session model change is unavoidable.** Revocation/concurrency/suspend all require server-side session records. Confirm we accept moving from pure stateless JWT to **server-tracked sessions** (e.g. JWT-with-sessionId validated against a Mongo `Session` collection, or opaque session tokens). This is the largest structural decision.
3. **Deployment topology guarantee.** Is production guaranteed single-instance long-term, or should we design for horizontal scale now? This decides whether rate-limit/session/lock state must be DB-backed (MongoDB Atlas transactions available) from day one. Recommendation: design DB-backed regardless.
4. **Are the Prisma `@unique` constraints actually enforced as Mongo indexes** on the live cluster (`User.email`, `ApiKey.prefix`)? Needed before relying on unique indexes for concurrent-session/device atomicity.
5. **Email provider / deliverability** for any future verification or security notifications — none exists today.
6. **Approximate geolocation source.** No IP geo/ASN lookup exists. If geo/impossible-travel signals are wanted, we need a provider (Cloudflare headers? MaxMind?) — decision affects privacy posture.
7. **Definition of "device limit" for browser-only usage.** The product is a web app with no native client; "device" will have to be a server-issued device credential (cookie-bound), which must be reconciled with the "trusted device" UX expectations in the brief. To be designed in Phase 3.
8. **Should the cross-tenant rate-update routes (C2) be treated as in-scope for this security project** or tracked separately? They're a live authorization defect but not strictly account-sharing.

---

PHASE 1 COMPLETE — WAITING FOR PHASE 2.
