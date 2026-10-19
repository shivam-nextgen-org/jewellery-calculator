# Atelier — Jewellery Pricing Platform

A short, plain-language overview of what this app is, what it does, and how it
works. Written so a non-developer (or ChatGPT) can quickly understand the whole
thing.

---

## 1. What it is (in one line)

A private, web-based tool for a jewellery business to turn a design sheet into
accurate, itemised prices for every metal/purity/colour/diamond combination of
a piece — and to save, review, and export those prices.

The brand name used in the UI is **"Atelier."**

---

## 2. Who uses it

Two kinds of accounts:

- **Super Admin** — manages users. Can create workspace users, enable/disable
  or delete them, and issue API keys. Admins only see the admin area.
- **User** — the normal jeweller account. Does all the pricing work. Each user
  only sees their **own** data (products, history, settings). One user's data
  is never visible to another.

Users log in with email + password. There's also an optional **API key** per
user so an external program can act as that user (same data, no browser login).

---

## 3. The core idea / main logic

A single piece of jewellery can be made in many combinations:

- **Metal:** Gold or Silver
- **Purity:** Gold = 24K / 22K / 18K / 14K / 10K / 9K · Silver = 999 / 958 / 925
- **Colour:** Gold = Yellow / White / Rose · Silver = Sterling Silver
- **Diamond type:** Natural / Lab Grown / Moissanite

The app takes **one design's details** (weights, diamond info) plus the
**current rates** and automatically calculates the price for **every selected
combination (a "variation")** at once. For example, picking 3 purities × 2
colours × 2 diamond types = 12 priced variations in one go.

### How one variation's price is calculated

For each variation the engine computes:

```
Gold/Metal price  = net weight (g) × per-gram rate for that purity
Diamond price     = diamond weight (CT) × diamond rate, then minus discount %
Making charge     = fixed amount, OR per-gram, OR a percentage of gold price
Other charges     = e.g. certification (fixed / per-gram / percentage)
--------------------------------------------------------------
Final price       = gold + diamond + making + other
```

Key points about the calculation:

- **Gold purities** are priced from the **24K gold rate × that purity's
  percentage** (e.g. 18K = 75% of 24K). **Silver purities** are priced from a
  **separate silver (999) per-gram rate** — gold and silver never mix.
- All money math uses a **precise decimal library** (not normal floating-point
  numbers), so prices don't drift by rounding errors.
- The user can **manually override** making charge, discount %, other charges,
  or the final price on any single variation; overrides are clearly flagged.

---

## 4. The user workflow (step by step)

The pricing workspace is a guided flow: **Import → Verify → Price → Variations → Review**

1. **Import** — Start from an uploaded **Excel sheet** (a template with many
   design rows) or enter a design **manually**. (There is also OCR support to
   read a design-sheet photo, including paste-from-clipboard.)
2. **Verify** — Pick a row and check/correct the extracted fields (design no,
   category, weights, diamond details). A **metal code** like `G10Y` (Gold 10K
   Yellow) or `S925` (Silver 925 Sterling) auto-fills metal/purity/colour.
3. **Price** — Choose which combinations to generate (metal, purities, colours,
   diamond types) and confirm the rates (gold rate, silver rate, diamond rates,
   making/other charges). An optional discount is applied only if ticked.
4. **Variations / Review** — See the full price table: one row per variation
   with the metal rate, metal ₹, diamond ₹, making, other, and final price.
   Expand any row to see the exact formula breakdown. Edit (override) any row.
5. **Save / Export** — Save the product (this **locks in the rates** used at
   that moment so historical prices never change), or **export the table to
   Excel** (same columns as on screen, styled header).

---

## 5. Rates: live updates

Rates can be refreshed automatically from an Indian bullion data source (IBJA
benchmark):

- **Gold 24K rate** — auto-updates daily (and a manual "Update from Live Rate"
  button). Stored per gram in ₹.
- **Silver 999 rate** — manual "Update from Live Rate" button (source reports
  per kilogram; the app converts to per gram).
- **Currency (FX) rates** — a daily snapshot for displaying prices in other
  currencies (INR stays the calculation currency). Auto-updates on a schedule.

Scheduling is done with an in-app cron (node-cron) that runs while the server is
up and calls the update endpoints. If an update source fails, the previous
rate is kept (it never overwrites good data with a failed fetch).

---

## 6. Settings (per user)

Each user has **Pricing Defaults** so they type less on every design:

- **Gold Defaults:** 24K gold rate + gold purity percentages.
- **Silver Defaults:** silver rate + silver purity percentages.
- **Diamond Defaults:** Natural / Lab Grown / Moissanite rates + optional
  default discount.
- **Charge Defaults:** default making charge and other charge (fixed / per-gram
  / percentage).

These preload into the pricing workspace automatically.

---

## 7. What gets stored

When a product is saved, the app stores a permanent snapshot so old prices stay
frozen even if rates change later:

- **Product** — the design and its details.
- **Variations** — each priced combination with its locked final price.
- **Pricing Calculation** — the exact rates/inputs used at save time (a
  historical record you can review on the **History** page).

Other data: users, per-user settings, API keys, OCR imports, and lookup lists.

---

## 8. The screens

- **Login** — email/password, show/hide password, "remember me".
- **Dashboard** — quick stats (total designs, today's imports, calculated
  products, total variations) + current gold rate + recent designs.
- **Jewellery Pricing** — the main workspace (the Import→Review flow above).
- **Products** — all saved products.
- **History** — every saved pricing calculation (frozen rate snapshots).
- **Settings** — the pricing defaults described above.
- **Admin (Users)** — super-admin only: create/disable/delete users, issue API
  keys.

The whole UI is responsive (works on phone, tablet, desktop). Loading states
show a themed animated loader over a blurred background.

---

## 9. Technology (for a developer)

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript.
- **Styling:** Tailwind CSS 4, with a custom champagne/ivory jewellery theme.
- **Database:** MongoDB (schema managed with Prisma; some access via the native
  MongoDB driver).
- **Auth:** JWT session stored in an httpOnly cookie (via `jose`), passwords
  hashed with bcrypt, plus hashed API keys.
- **Pricing engine:** a dedicated, well-tested module using `decimal.js` for
  exact money math (never duplicated in the UI).
- **OCR:** Tesseract.js (reads design-sheet images locally).
- **Excel:** `xlsx` / `xlsx-js-style` for import and styled export.
- **Scheduling:** `node-cron` for daily rate/FX updates.
- **Deployment:** can run as a Next.js standalone server on a VPS.

---

## 10. One-paragraph summary (for ChatGPT)

I built "Atelier," a private web app for a jewellery business that turns one
design's details plus current gold/silver/diamond rates into a full price table
for every metal/purity/colour/diamond-type combination at once. It has a guided
Import → Verify → Price → Review flow (Excel upload, manual entry, or OCR), a
precise decimal pricing engine (gold priced off the 24K rate × purity %, silver
off a separate silver rate, plus making/other charges and optional discount,
with per-row overrides), live daily rate updates, per-user pricing defaults,
saved products with frozen rate snapshots and history, Excel export, API keys,
and an admin area for managing users. Built with Next.js 16, React, TypeScript,
Tailwind, MongoDB, and JWT auth — fully responsive.
