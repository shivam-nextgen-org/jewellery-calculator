import {
  calculateEtsyInclusiveSalePrice,
  DEFAULT_ETSY_APPLICABLE,
  type EtsyApplicableFlags,
} from "@/lib/etsy/calculate-breakdown";
import { toMoneyNumber, toMoneyString } from "@/lib/pricing-engine/decimal";
import type { PricedVariation } from "@/lib/pricing-engine/types";
import type { EtsyCommissionSettings } from "@/types/etsy";

/**
 * Add Etsy marketplace fees as a per-variation addon on jewellery final.
 * - `etsy.jewelleryFinalPrice` — jewellery-only total
 * - `etsy.etsyAmount` — addon (Etsy total)
 * - `calculation.finalPrice` — jewellery + Etsy total
 */
export function applyEtsyToPricedVariations(
  variations: PricedVariation[],
  settings: EtsyCommissionSettings,
  applicable?: Partial<EtsyApplicableFlags>,
): PricedVariation[] {
  const flags = { ...DEFAULT_ETSY_APPLICABLE, ...applicable };

  return variations.map((row) => {
    const jewellery = toMoneyNumber(row.calculation.finalPrice);
    const inclusive = calculateEtsyInclusiveSalePrice({
      productCost: jewellery,
      settings,
      applicable: flags,
    });

    return {
      ...row,
      etsy: {
        jewelleryFinalPrice: toMoneyString(jewellery),
        etsyAmount: toMoneyString(inclusive.etsyAmount),
      },
      calculation: {
        ...row.calculation,
        finalPrice: toMoneyString(inclusive.salePrice),
      },
    };
  });
}
