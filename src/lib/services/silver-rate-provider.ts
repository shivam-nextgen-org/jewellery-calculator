/**
 * Replaceable Indian domestic silver-rate provider.
 * Consumers only see a validated INR/gram silver (999) rate.
 *
 * NOTE: The SnapData silver feed reports value in INR per KILOGRAM
 * (instrument XAG / XAG.INR.KG), so we divide by 1000 to get INR/gram.
 */

export type IndianSilverQuote = {
  /** INR per gram for 999 silver. */
  rateInrPerGram: number;
  currency: "INR";
  purity: "999";
  unit: "gram";
  source: string;
  provider: string;
  sourceDate: string;
  retrievedAt: string | null;
};

export interface SilverRateProvider {
  readonly id: string;
  fetchIndianSilverRate(): Promise<IndianSilverQuote>;
}

type SnapObservation = {
  date?: string;
  instrument?: string;
  instrument_id?: string;
  value?: number;
  close?: number;
  source?: string;
};

type SnapPayload = {
  unit?: { quantity?: string; currency?: string };
  generated_at?: string;
  sources?: Array<{ id?: string; name?: string; retrieved_at?: string }>;
  observations?: SnapObservation[];
};

const MIN_INR_PER_GRAM = 20;
const MAX_INR_PER_GRAM = 5_000;

function assertPositiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function parseSnapDataSilverPayload(body: SnapPayload): IndianSilverQuote {
  const quantity = body.unit?.quantity?.toLowerCase();
  const currency = body.unit?.currency?.toUpperCase();

  if (currency !== "INR") {
    throw new Error(
      `Unexpected currency "${body.unit?.currency ?? "?"}" — expected INR`,
    );
  }

  const observations = body.observations;
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error("SnapData silver response has no observations");
  }

  const obs =
    observations.find(
      (o) =>
        o.instrument === "XAG" ||
        o.instrument === "XAG.999" ||
        o.instrument_id?.startsWith("XAG."),
    ) ?? observations[0];

  const raw = obs.close ?? obs.value;
  let rate = assertPositiveFinite(Number(raw), "Indian silver rate");

  // The feed is per-kilogram — convert to per-gram.
  if (quantity === "kilogram" || quantity === "kg") {
    rate = rate / 1000;
  }

  if (rate < MIN_INR_PER_GRAM || rate > MAX_INR_PER_GRAM) {
    throw new Error(
      `Indian silver rate ${rate} outside expected INR/gram band (${MIN_INR_PER_GRAM}–${MAX_INR_PER_GRAM})`,
    );
  }

  const sourceEntry =
    body.sources?.find((s) => s.id === "ibja") ?? body.sources?.[0];
  const sourceDate = obs.date || body.generated_at?.slice(0, 10);
  if (!sourceDate) {
    throw new Error("SnapData silver observation missing date");
  }
  const sourceId = (obs.source || sourceEntry?.id || "ibja").toLowerCase();

  return {
    rateInrPerGram: rate,
    currency: "INR",
    purity: "999",
    unit: "gram",
    source: sourceId === "ibja" ? "IBJA" : sourceEntry?.name || "IBJA",
    provider: "snapdata",
    sourceDate,
    retrievedAt: sourceEntry?.retrieved_at ?? body.generated_at ?? null,
  };
}

export class SnapDataIndianSilverProvider implements SilverRateProvider {
  readonly id = "snapdata";

  constructor(private readonly apiUrl: string) {}

  async fetchIndianSilverRate(): Promise<IndianSilverQuote> {
    const res = await fetch(this.apiUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`SnapData silver API error (${res.status})`);
    }
    const body = (await res.json()) as SnapPayload;
    return parseSnapDataSilverPayload(body);
  }
}

export function getSilverRateProvider(): SilverRateProvider {
  const url =
    process.env.SILVER_RATE_API_URL?.trim() ||
    "https://snapdata.dev/api/v1/silver/in/latest.json";
  return new SnapDataIndianSilverProvider(url);
}
