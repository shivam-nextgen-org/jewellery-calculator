import { getDb } from "@/lib/mongo";
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from "@/lib/fx/currencies";

export const FX_SNAPSHOT_COLLECTION = "FxDailySnapshot";

export type FxDailySnapshot = {
  baseCurrency: "INR";
  effectiveDate: string;
  capturedAt: string;
  source: string;
  rates: Partial<Record<SupportedCurrency, number>>;
  status: "success";
};

function fxApiBaseUrl(): string {
  return (
    process.env.FX_API_BASE_URL?.replace(/\/$/, "") ||
    "https://open.er-api.com/v6"
  );
}

function todayEffectiveDateIst(): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.FX_RATE_TIMEZONE?.trim() || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export type FxUpdateResult =
  | { ok: true; snapshot: FxDailySnapshot }
  | { ok: false; error: string };

/**
 * Fetch latest INR-based rates, validate, upsert today's success snapshot.
 * On failure: does not overwrite any previous successful snapshot.
 */
export async function updateDailyRates(): Promise<FxUpdateResult> {
  try {
    const url = `${fxApiBaseUrl()}/latest/INR`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`FX API error (${res.status})`);
    }

    const body = (await res.json()) as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
    };

    if (body.result && body.result !== "success") {
      throw new Error("FX API result was not success");
    }

    const base = body.base_code ?? "INR";
    if (base !== "INR") {
      throw new Error(`Unexpected FX base currency: ${base}`);
    }

    if (!body.rates || typeof body.rates !== "object") {
      throw new Error("FX API missing rates");
    }

    const rates: Partial<Record<SupportedCurrency, number>> = { INR: 1 };

    for (const code of SUPPORTED_CURRENCIES) {
      if (code === "INR") continue;
      const raw = body.rates[code];
      if (!isPositiveNumber(raw)) {
        throw new Error(`Missing or invalid rate for ${code}`);
      }
      rates[code] = raw;
    }

    const effectiveDate = todayEffectiveDateIst();
    const snapshot: FxDailySnapshot = {
      baseCurrency: "INR",
      effectiveDate,
      capturedAt: new Date().toISOString(),
      source: "ExchangeRate-API",
      rates,
      status: "success",
    };

    const db = await getDb();
    await db.collection(FX_SNAPSHOT_COLLECTION).updateOne(
      { baseCurrency: "INR", effectiveDate },
      { $set: snapshot },
      { upsert: true },
    );

    return { ok: true, snapshot };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to update FX rates";
    console.error(
      "[fx-rates] update failed — keeping previous snapshot:",
      message,
    );
    return { ok: false, error: message };
  }
}

/** Latest successful snapshot (any date). */
export async function getLatestSuccessfulSnapshot(): Promise<FxDailySnapshot | null> {
  const db = await getDb();
  const row = await db
    .collection(FX_SNAPSHOT_COLLECTION)
    .find({ status: "success", baseCurrency: "INR" })
    .sort({ effectiveDate: -1, capturedAt: -1 })
    .limit(1)
    .next();

  if (!row) return null;

  return {
    baseCurrency: "INR",
    effectiveDate: String(row.effectiveDate),
    capturedAt: String(row.capturedAt),
    source: String(row.source ?? "ExchangeRate-API"),
    rates: (row.rates ?? {}) as FxDailySnapshot["rates"],
    status: "success",
  };
}
