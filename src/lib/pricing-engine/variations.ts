import type {
  DiamondTypeOption,
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
} from "@/types/jewellery";
import { calculateJewelleryPrice, hasAnyOverride } from "./calculate";
import { d, toMoneyNumber } from "./decimal";
import { calculatePurityRatePerGram } from "./gold";
import type {
  PricedVariation,
  PricingSessionInput,
  VariationOverrides,
  VariationSpec,
} from "./types";

const METAL_LABELS: Record<GoldMetalOption, string> = {
  gold: "Gold",
  silver: "Silver",
  platinum: "Platinum",
};

const COLOR_LABELS: Record<GoldColorOption, string> = {
  yellow: "Yellow Gold",
  white: "White Gold",
  rose: "Rose Gold",
};

const DIAMOND_TYPE_LABELS: Record<DiamondTypeOption, string> = {
  natural: "Natural",
  "lab-grown": "Lab Grown",
  moissanite: "Moissanite",
};

export function countVariations(
  metals: GoldMetalOption[],
  purities: GoldPurityOption[],
  colors: GoldColorOption[],
  diamondTypes: DiamondTypeOption[],
): number {
  const dTypes = diamondTypes.length > 0 ? diamondTypes.length : 1;
  return metals.length * purities.length * colors.length * dTypes;
}

function rateForDiamondType(
  diamondType: DiamondTypeOption,
  diamondRateNatural: PricingSessionInput["diamondRateNatural"],
  diamondRateLabGrown: PricingSessionInput["diamondRateLabGrown"],
  diamondRateMoissanite: PricingSessionInput["diamondRateMoissanite"],
) {
  if (diamondType === "lab-grown") return diamondRateLabGrown;
  if (diamondType === "moissanite") return diamondRateMoissanite;
  return diamondRateNatural;
}

export function generateVariationSpecs(
  metals: GoldMetalOption[],
  purities: GoldPurityOption[],
  colors: GoldColorOption[],
  diamondTypes: DiamondTypeOption[],
  gold24kRate: PricingSessionInput["gold24kRate"],
  purityPercentages: PricingSessionInput["purityPercentages"],
  diamondRateNatural: PricingSessionInput["diamondRateNatural"],
  diamondRateLabGrown: PricingSessionInput["diamondRateLabGrown"],
  diamondRateMoissanite: PricingSessionInput["diamondRateMoissanite"] = 0,
): VariationSpec[] {
  const specs: VariationSpec[] = [];
  const types =
    diamondTypes.length > 0 ? diamondTypes : (["natural"] as DiamondTypeOption[]);

  for (const metal of metals) {
    for (const purity of purities) {
      for (const color of colors) {
        for (const diamondType of types) {
          const percent = purityPercentages[purity] ?? 0;
          const ratePerGram = calculatePurityRatePerGram(gold24kRate, percent);
          const diamondRate = rateForDiamondType(
            diamondType,
            diamondRateNatural,
            diamondRateLabGrown,
            diamondRateMoissanite,
          );
          const colorShort = COLOR_LABELS[color].replace(" Gold", "");
          const diaLabel = DIAMOND_TYPE_LABELS[diamondType];
          specs.push({
            id: `${metal}-${purity}-${color}-${diamondType}`,
            metal,
            metalLabel: METAL_LABELS[metal],
            purity,
            color,
            colorLabel: COLOR_LABELS[color],
            diamondType,
            diamondTypeLabel: diaLabel,
            label: `${purity} ${colorShort} · ${diaLabel}`,
            goldRatePerGram: ratePerGram.toFixed(2),
            goldPurityPercent: d(percent).toString(),
            diamondRate: d(diamondRate).toFixed(2),
          });
        }
      }
    }
  }

  return specs;
}

export function calculateAllVariations(
  session: PricingSessionInput,
): PricedVariation[] {
  const specs = generateVariationSpecs(
    session.metals,
    session.purities,
    session.colors,
    session.diamondTypes,
    session.gold24kRate,
    session.purityPercentages,
    session.diamondRateNatural,
    session.diamondRateLabGrown,
    session.diamondRateMoissanite ?? 0,
  );

  return specs.map((spec) => {
    const overrides: VariationOverrides | undefined =
      session.overridesByVariationId?.[spec.id];

    const calculation = calculateJewelleryPrice({
      netWeight: session.netWeight,
      goldRatePerGram: spec.goldRatePerGram,
      diamondWeight: session.diamondWeight,
      diamondRate: spec.diamondRate,
      diamondDiscountPercent: session.diamondDiscountPercent,
      makingCharge: session.makingCharge,
      makingCalcType: session.makingCalcType,
      otherCharges: session.otherCharges,
      overrides,
    });

    return {
      ...spec,
      calculation,
      hasManualOverride: hasAnyOverride(calculation),
    };
  });
}

export function getPriceRange(variations: PricedVariation[]): {
  min: number;
  max: number;
} {
  if (variations.length === 0) return { min: 0, max: 0 };
  const values = variations.map((v) =>
    toMoneyNumber(v.calculation.finalPrice),
  );
  return { min: Math.min(...values), max: Math.max(...values) };
}
