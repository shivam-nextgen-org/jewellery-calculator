# Atelier · Jewellery Pricing

## Quick start

1. Install and start [MongoDB Community](https://www.mongodb.com/try/download/community) locally (default port **27017**).

2. Ensure `.env` has:

```
DATABASE_URL="mongodb://localhost:27017/atelier"
OCR_PROVIDER=mock
```

3. Push schema + seed (first time):

```bash
npx prisma db push
npm run db:seed
```

4. Run app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run db:push` | Sync Prisma schema to MongoDB |
| `npm run db:seed` | Seed lookups + pricing defaults |
| `npm run db:studio` | Prisma Studio |

## OCR (real)

Default provider is **Tesseract.js** with **local** language data (no CDN at runtime).

```bash
npm run ocr:tessdata   # once — downloads eng.traineddata.gz into ./tessdata
npm run dev
```

`.env`:

```env
OCR_PROVIDER=tesseract
```

1. Upload a clear design-sheet image on `/pricing`
2. Click **Process image**
3. Verify / correct fields → Continue to Pricing

Demo mode without real images:

```env
OCR_PROVIDER=mock
```

## Phase status

- ✅ Phase 1 — App shell + Pricing Workspace UI
- ✅ Phase 2 — Decimal pricing engine + live variations
- ✅ Phase 3 — Prisma + MongoDB, defaults, save product + snapshots
- ✅ Phase 4 — OCR abstraction + gold-code parser + verify wiring
- ✅ Real OCR — Tesseract.js local provider + sheet text parser
- ⏳ Export / auth / cloud Vision providers
