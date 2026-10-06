import type {
  DiamondTypeOption,
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
  PricingGradeRule,
} from "@/types/jewellery";
import { calculateJewelleryPrice, hasAnyOverride } from "./calculate";
import { d, toMoneyNumber } from "./decimal";
import { calculateRateFromGradeProfile } from "./grade-adjustments";
import { calculatePurityRatePerGram } from "./gold";
import type {
  DiamondGradeProfileInput,
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
  sterling: "Sterling Silver",
};

const DIAMOND_TYPE_LABELS: Record<DiamondTypeOption, string> = {
  natural: "Natural",
  "lab-grown": "Lab Grown",
  moissanite: "Moissanite",
};

// Silver purities price off the silver base rate; everything else off gold 24K.
const SILVER_PURITIES: GoldPurityOption[] = ["925", "958", "999"];

function baseRateForPurity(
  purity: GoldPurityOption,
  gold24kRate: PricingSessionInput["gold24kRate"],
  silverRate: PricingSessionInput["silverRate"],
) {
  return SILVER_PURITIES.includes(purity) ? silverRate : gold24kRate;
}

const SILVER_COLORS: GoldColorOption[] = ["sterling"];

/**
 * Only real metal/purity/colour pairings become variations:
 *   silver → silver purities (925/958/999) and Sterling Silver colour
 *   gold (and platinum) → karat purities and Yellow/White/Rose colours
 */
export function isValidCombination(
  metal: GoldMetalOption,
  purity: GoldPurityOption,
  color: GoldColorOption,
): boolean {
  const silverMetal = metal === "silver";
  return (
    SILVER_PURITIES.includes(purity) === silverMetal &&
    SILVER_COLORS.includes(color) === silverMetal
  );
}

/** Trade-style short label: "G-VS1" or "Colorless-VS". */
export function formatDiamondGradeLabel(
  colorGrade: string | null | undefined,
  clarityGrade: string | null | undefined,
): string | null {
  const c = colorGrade?.trim();
  const cl = clarityGrade?.trim();
  if (!c && !cl) return null;
  if (c && cl) return `${c}-${cl}`;
  return c || cl || null;
}

export function countVariations(
  metals: GoldMetalOption[],
  purities: GoldPurityOption[],
  colors: GoldColorOption[],
  diamondTypes: DiamondTypeOption[],
  diamondColors?: string[],
  diamondClarities?: string[],
): number {
  const dTypes = diamondTypes.length > 0 ? diamondTypes.length : 1;
  const colorCount = diamondColors && diamondColors.length > 0 ? diamondColors.length : 1;
  const clarityCount =
    diamondClarities && diamondClarities.length > 0 ? diamondClarities.length : 1;
  let combos = 0;
  for (const metal of metals) {
    for (const purity of purities) {
      for (const color of colors) {
        if (isValidCombination(metal, purity, color)) combos += 1;
      }
    }
  }
  return combos * dTypes * colorCount * clarityCount;
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

/** Resolve discount % for a stone type, falling back to legacy single discount. */
export function discountPercentForDiamondType(
  session: Pick<
    PricingSessionInput,
    | "diamondDiscountPercent"
    | "diamondDiscountPercentNatural"
    | "diamondDiscountPercentLabGrown"
    | "diamondDiscountPercentMoissanite"
  >,
  diamondType: DiamondTypeOption,
): NonNullable<PricingSessionInput["diamondDiscountPercent"]> {
  const legacy = session.diamondDiscountPercent ?? 0;
  if (diamondType === "lab-grown") {
    return session.diamondDiscountPercentLabGrown ?? legacy;
  }
  if (diamondType === "moissanite") {
    return session.diamondDiscountPercentMoissanite ?? legacy;
  }
  return session.diamondDiscountPercentNatural ?? legacy;
}

function adjustedDiamondRate(
  baseRate: PricingSessionInput["diamondRateNatural"],
  diamondType: DiamondTypeOption,
  colorGrade: string | null,
  clarityGrade: string | null,
  gradeByType: PricingSessionInput["diamondGradeByType"],
): string {
  const profile = gradeByType?.[diamondType];
  if (!profile || (!colorGrade && !clarityGrade)) {
    return d(baseRate).toFixed(2);
  }
  const result = calculateRateFromGradeProfile({
    basePricePerCt: baseRate,
    colorRules: profile.colorRules as PricingGradeRule[],
    clarityRules: profile.clarityRules as PricingGradeRule[],
    colorGrade: colorGrade ?? profile.colorRules[0]?.grade,
    clarityGrade: clarityGrade ?? profile.clarityRules[0]?.grade,
    calculationMethod: profile.calculationMethod,
  });
  return result.ratePerCt;
}

function gradeAxes(
  diamondColors?: string[],
  diamondClarities?: string[],
): { color: string | null; clarity: string | null }[] {
  const colors =
    diamondColors && diamondColors.length > 0 ? diamondColors : [null];
  const clarities =
    diamondClarities && diamondClarities.length > 0 ? diamondClarities : [null];
  const axes: { color: string | null; clarity: string | null }[] = [];
  for (const color of colors) {
    for (const clarity of clarities) {
      axes.push({ color, clarity });
    }
  }
  return axes;
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
  silverRate: PricingSessionInput["silverRate"] = 0,
  diamondColors?: string[],
  diamondClarities?: string[],
  diamondGradeByType?: PricingSessionInput["diamondGradeByType"],
): VariationSpec[] {
  const specs: VariationSpec[] = [];
  const types =
    diamondTypes.length > 0 ? diamondTypes : (["natural"] as DiamondTypeOption[]);
  const grades = gradeAxes(diamondColors, diamondClarities);

  for (const metal of metals) {
    for (const purity of purities) {
      for (const color of colors) {
        if (!isValidCombination(metal, purity, color)) continue;
        for (const diamondType of types) {
          for (const grade of grades) {
            const percent = purityPercentages[purity] ?? 0;
            const baseRate = baseRateForPurity(purity, gold24kRate, silverRate);
            const ratePerGram = calculatePurityRatePerGram(baseRate, percent);
            const diamondBase = rateForDiamondType(
              diamondType,
              diamondRateNatural,
              diamondRateLabGrown,
              diamondRateMoissanite,
            );
            const diamondRate = adjustedDiamondRate(
              diamondBase,
              diamondType,
              grade.color,
              grade.clarity,
              diamondGradeByType,
            );
            const colorShort = COLOR_LABELS[color].replace(" Gold", "");
            const diaLabel = DIAMOND_TYPE_LABELS[diamondType];
            const gradeLabel = formatDiamondGradeLabel(grade.color, grade.clarity);
            const idParts = [
              metal,
              purity,
              color,
              diamondType,
              grade.color ?? "_",
              grade.clarity ?? "_",
            ];
            specs.push({
              id: idParts.join("-"),
              metal,
              metalLabel: METAL_LABELS[metal],
              purity,
              color,
              colorLabel: COLOR_LABELS[color],
              diamondType,
              diamondTypeLabel: diaLabel,
              diamondColorGrade: grade.color,
              diamondClarityGrade: grade.clarity,
              label: gradeLabel
                ? `${purity} ${colorShort} · ${diaLabel} · ${gradeLabel}`
                : `${purity} ${colorShort} · ${diaLabel}`,
              goldRatePerGram: ratePerGram.toFixed(2),
              goldPurityPercent: d(percent).toString(),
              diamondRate,
            });
          }
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
    session.silverRate ?? 0,
    session.diamondColors,
    session.diamondClarities,
    session.diamondGradeByType,
  );

  return specs.map((spec) => {
    const overrides: VariationOverrides | undefined =
      session.overridesByVariationId?.[spec.id];

    const calculation = calculateJewelleryPrice({
      netWeight: session.netWeight,
      goldRatePerGram: spec.goldRatePerGram,
      diamondWeight: session.diamondWeight,
      diamondRate: spec.diamondRate,
      diamondDiscountPercent: discountPercentForDiamondType(
        session,
        spec.diamondType,
      ),
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

export type { DiamondGradeProfileInput };
