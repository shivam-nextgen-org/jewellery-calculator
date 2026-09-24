import { unstable_cache, revalidateTag } from "next/cache";
import type { ChargeCalcType, PricingDefaults } from "@/types/jewellery";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import { getDb, ObjectId, oid } from "@/lib/mongo";

export const PRICING_DEFAULTS_KEY = "pricing_defaults";

function pricingDefaultsTag(userId: string) {
  return `pricing-defaults:${userId}`;
}

export function toPrismaChargeCalcType(
  value: ChargeCalcType,
): "PER_GRAM" | "PERCENTAGE" | "FIXED" {
  switch (value) {
    case "per-gram":
      return "PER_GRAM";
    case "percentage":
      return "PERCENTAGE";
    default:
      return "FIXED";
  }
}

export function decimalToNumber(
  value: number | string | { toNumber: () => number } | null | undefined,
): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return value.toNumber();
}

export function parsePricingDefaults(value: unknown): PricingDefaults {
  const raw = (value ?? {}) as Partial<PricingDefaults> & {
    defaultDiamondRate?: number;
  };
  const natural =
    raw.defaultDiamondRateNatural ??
    raw.defaultDiamondRate ??
    MOCK_PRICING_DEFAULTS.defaultDiamondRateNatural;
  const labGrown =
    raw.defaultDiamondRateLabGrown ??
    MOCK_PRICING_DEFAULTS.defaultDiamondRateLabGrown;

  return {
    ...MOCK_PRICING_DEFAULTS,
    ...raw,
    purityPercentages: {
      ...MOCK_PRICING_DEFAULTS.purityPercentages,
      ...(raw.purityPercentages ?? {}),
    },
    defaultDiamondRate: natural,
    defaultDiamondRateNatural: natural,
    defaultDiamondRateLabGrown: labGrown,
  };
}

async function fetchPricingDefaults(
  userId: string,
): Promise<PricingDefaults> {
  const db = await getDb();
  const row = await db.collection("AppSetting").findOne({
    userId: oid(userId),
    key: PRICING_DEFAULTS_KEY,
  });
  if (!row) return structuredClone(MOCK_PRICING_DEFAULTS);
  return parsePricingDefaults(row.value);
}

/**
 * Pricing defaults change rarely but are read on every /pricing and /settings
 * visit. Cache per user (tagged) so navigation reuses the value instead of
 * hitting Atlas each time. Invalidated on save via setPricingDefaults.
 */
export async function getPricingDefaults(
  userId: string,
): Promise<PricingDefaults> {
  const cached = unstable_cache(
    () => fetchPricingDefaults(userId),
    ["pricing-defaults", userId],
    { tags: [pricingDefaultsTag(userId)], revalidate: 300 },
  );
  return cached();
}

export async function setPricingDefaults(
  userId: string,
  defaults: PricingDefaults,
): Promise<PricingDefaults> {
  const db = await getDb();
  const now = new Date();
  await db.collection("AppSetting").updateOne(
    { userId: oid(userId), key: PRICING_DEFAULTS_KEY },
    {
      $set: { value: defaults, updatedAt: now },
      $setOnInsert: {
        _id: new ObjectId(),
        userId: oid(userId),
        key: PRICING_DEFAULTS_KEY,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  // This Next version's revalidateTag requires a profile; { expire: 0 }
  // expires the cached entry immediately so the next read is fresh.
  revalidateTag(pricingDefaultsTag(userId), { expire: 0 });
  return parsePricingDefaults(defaults);
}
