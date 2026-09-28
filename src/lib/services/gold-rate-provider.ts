/**
 * Replaceable Indian domestic gold-rate provider.
 * Application consumers only see a validated INR/gram 24K (999) rate.
 */

export type IndianGoldQuote = {
  /** INR per gram for 24K / 999. */
  rateInrPerGram: number;
  currency: "INR";
  purity: "999" | "24K";
  unit: "gram";
  source: string;
  provider: string;
  sourceDate: string;
  retrievedAt: string | null;
};

export interface GoldRateProvider {
  readonly id: string;
  fetchIndian24kRate(): Promise<IndianGoldQuote>;
}

type SnapObservation = {
  date?: string;
  instrument?: string;
  instrument_id?: string;
  value?: number;
  close?: number;
  status?: string;
  is_trading_day?: boolean;
  source?: string;
};

type SnapPayload = {
  unit?: { quantity?: string; currency?: string };
  generated_at?: string;
  sources?: Array<{ id?: string; name?: string; retrieved_at?: string }>;
  observations?: SnapObservation[];
};

const MIN_INR_PER_GRAM = 5_000;
const MAX_INR_PER_GRAM = 100_000;

function assertPositiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/**
 * Prefer explicit 999, else IBJA-style XAU.24K (24K ≈ 999 in this feed).
 */
export function pick24kObservation(
  observations: SnapObservation[],
): SnapObservation {
  const by999 = observations.find(
    (o) =>
      o.instrument === "XAU.999" ||
      o.instrument_id?.startsWith("XAU.999.") ||
      o.instrument === "999",
  );
  if (by999) return by999;

  const by24k = observations.find(
    (o) =>
      o.instrument === "XAU.24K" ||
      o.instrument_id?.startsWith("XAU.24K.") ||
      o.instrument === "24K",
  );
  if (by24k) return by24k;

  throw new Error("SnapData response missing XAU.24K / 999 observation");
}

export function parseSnapDataGoldPayload(body: SnapPayload): IndianGoldQuote {
  const quantity = body.unit?.quantity?.toLowerCase();
  const currency = body.unit?.currency?.toUpperCase();

  if (quantity !== "gram") {
    throw new Error(
      `Unexpected unit quantity "${body.unit?.quantity ?? "?"}" — expected gram`,
    );
  }
  if (currency !== "INR") {
    throw new Error(
      `Unexpected currency "${body.unit?.currency ?? "?"}" — expected INR`,
    );
  }

  const observations = body.observations;
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error("SnapData response has no observations");
  }

  const obs = pick24kObservation(observations);
  const raw = obs.close ?? obs.value;
  const rate = assertPositiveFinite(Number(raw), "Indian 24K gold rate");

  // Guard against accidental per-10g / per-kg mis-parse without auto-scaling.
  if (rate < MIN_INR_PER_GRAM || rate > MAX_INR_PER_GRAM) {
    throw new Error(
      `Indian gold rate ${rate} outside expected INR/gram band (${MIN_INR_PER_GRAM}–${MAX_INR_PER_GRAM})`,
    );
  }

  const sourceEntry = body.sources?.find((s) => s.id === "ibja") ?? body.sources?.[0];
  const sourceDate = obs.date || body.generated_at?.slice(0, 10);
  if (!sourceDate) {
    throw new Error("SnapData observation missing date");
  }

  const sourceId = (obs.source || sourceEntry?.id || "ibja").toLowerCase();

  return {
    rateInrPerGram: rate,
    currency: "INR",
    purity: obs.instrument?.includes("999") ? "999" : "24K",
    unit: "gram",
    source: sourceId === "ibja" ? "IBJA" : sourceEntry?.name || "IBJA",
    provider: "snapdata",
    sourceDate,
    retrievedAt: sourceEntry?.retrieved_at ?? body.generated_at ?? null,
  };
}

export class SnapDataIndianGoldProvider implements GoldRateProvider {
  readonly id = "snapdata";

  constructor(private readonly apiUrl: string) {}

  async fetchIndian24kRate(): Promise<IndianGoldQuote> {
    const res = await fetch(this.apiUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`SnapData gold API error (${res.status})`);
    }

    const body = (await res.json()) as SnapPayload;
    return parseSnapDataGoldPayload(body);
  }
}

export function getGoldRateProvider(): GoldRateProvider {
  const provider = (process.env.GOLD_RATE_PROVIDER ?? "snapdata").trim().toLowerCase();
  const url =
    process.env.GOLD_RATE_API_URL?.trim() ||
    "https://snapdata.dev/api/v1/gold/in/latest.json";

  if (provider === "snapdata") {
    return new SnapDataIndianGoldProvider(url);
  }

  // Default / unknown → SnapData (replaceable later with official IBJA).
  return new SnapDataIndianGoldProvider(url);
}
