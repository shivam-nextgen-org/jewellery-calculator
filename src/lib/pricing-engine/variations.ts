import type {
  DiamondTypeOption,
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
  PricingGradeRule,
  StoneGradeSelection,
} from "@/types/jewellery";
import { calculateJewelleryPrice, hasAnyOverride } from "./calculate";
import { d, toMoneyNumber } from "./decimal";
import {
  clarityGradeScaleForStoneType,
  colorGradeScaleForStoneType,
} from "./grade-defaults";
import { calculateRateFromGradeProfile } from "./grade-adjustments";
import { calculatePurityRatePerGram } from "./gold";
import type {
  DiamondGradeProfileInput,
  DiamondGradeProfileMap,
  PricedVariation,
  PricingSessionInput,
  VariationBreakdown,
  VariationMatrixInput,
  VariationOverrides,
  VariationSpec,
  VariationSpecInput,
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

/** How many real metal × purity × colour pairings the selection spans. */
export function countMetalCombinations(
  metals: GoldMetalOption[],
  purities: GoldPurityOption[],
  colors: GoldColorOption[],
): number {
  let combos = 0;
  for (const metal of metals) {
    for (const purity of purities) {
      for (const color of colors) {
        if (isValidCombination(metal, purity, color)) combos += 1;
      }
    }
  }
  return combos;
}

/** Grades a stone type may be priced at — its % rules, else its own scale. */
function allowedGradesForStoneType(
  stoneType: DiamondTypeOption,
  axis: "color" | "clarity",
  gradeByType: DiamondGradeProfileMap | undefined,
): readonly string[] {
  const profile = gradeByType?.[stoneType];
  const rules = axis === "color" ? profile?.colorRules : profile?.clarityRules;
  if (rules && rules.length > 0) return rules.map((r) => r.grade);
  return axis === "color"
    ? colorGradeScaleForStoneType(stoneType)
    : clarityGradeScaleForStoneType(stoneType);
}

function keepGradesOnScale(
  grades: string[] | undefined,
  allowed: readonly string[],
): string[] {
  if (!grades || grades.length === 0) return [];
  const byLower = new Map(allowed.map((g) => [g.trim().toLowerCase(), g]));
  const kept: string[] = [];
  for (const grade of grades) {
    const match = byLower.get(grade.trim().toLowerCase());
    if (match && !kept.includes(match)) kept.push(match);
  }
  return kept;
}

/**
 * Grades that actually apply to one stone type. Per-stone selections win; a
 * legacy global selection is narrowed to the grades on that stone's scale, so
 * Moissanite bands never build Natural / Lab Grown rows and GIA grades never
 * build Moissanite rows.
 */
export function resolveStoneGrades(
  input: VariationMatrixInput,
  stoneType: DiamondTypeOption,
): StoneGradeSelection {
  const picked = input.stoneGrades?.[stoneType];
  const colors = picked ? picked.colors : input.diamondColors;
  const clarities = picked ? picked.clarities : input.diamondClarities;
  return {
    colors: keepGradesOnScale(
      colors,
      allowedGradesForStoneType(stoneType, "color", input.diamondGradeByType),
    ),
    clarities: keepGradesOnScale(
      clarities,
      allowedGradesForStoneType(stoneType, "clarity", input.diamondGradeByType),
    ),
  };
}

function selectedStoneTypes(
  diamondTypes: DiamondTypeOption[],
): DiamondTypeOption[] {
  return diamondTypes.length > 0 ? diamondTypes : ["natural"];
}

/** Price rows one stone type adds per metal combination (never fewer than 1). */
export function countStoneRows(
  input: VariationMatrixInput,
  stoneType: DiamondTypeOption,
): number {
  const grades = resolveStoneGrades(input, stoneType);
  const colors = grades.colors.length || 1;
  const clarities = grades.clarities.length || 1;
  return colors * clarities;
}

/**
 * Variations = valid metal × purity × colour pairings × the sum of each
 * selected stone type's own colour × clarity grid.
 */
export function countVariations(input: VariationMatrixInput): number {
  const metalCombinations = countMetalCombinations(
    input.metals,
    input.purities,
    input.colors,
  );
  const stoneRows = selectedStoneTypes(input.diamondTypes).reduce(
    (total, stoneType) => total + countStoneRows(input, stoneType),
    0,
  );
  return metalCombinations * stoneRows;
}

/** Count split the way the config panel shows it. */
export function variationBreakdown(
  input: VariationMatrixInput,
): VariationBreakdown {
  const metalCombinations = countMetalCombinations(
    input.metals,
    input.purities,
    input.colors,
  );
  const rowsByStoneType: Partial<Record<DiamondTypeOption, number>> = {};
  let stoneRows = 0;
  for (const stoneType of selectedStoneTypes(input.diamondTypes)) {
    const rows = countStoneRows(input, stoneType);
    rowsByStoneType[stoneType] = rows;
    stoneRows += rows;
  }
  return {
    metalCombinations,
    stoneRows,
    rowsByStoneType,
    total: metalCombinations * stoneRows,
  };
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
  grades: StoneGradeSelection,
): { color: string | null; clarity: string | null }[] {
  const colors = grades.colors.length > 0 ? grades.colors : [null];
  const clarities = grades.clarities.length > 0 ? grades.clarities : [null];
  const axes: { color: string | null; clarity: string | null }[] = [];
  for (const color of colors) {
    for (const clarity of clarities) {
      axes.push({ color, clarity });
    }
  }
  return axes;
}

export function generateVariationSpecs(
  input: VariationSpecInput,
): VariationSpec[] {
  const {
    metals,
    purities,
    colors,
    gold24kRate,
    purityPercentages,
    diamondRateNatural,
    diamondRateLabGrown,
    diamondRateMoissanite = 0,
    silverRate = 0,
    diamondGradeByType,
  } = input;
  const specs: VariationSpec[] = [];
  const types = selectedStoneTypes(input.diamondTypes);
  const gradesByType = new Map(
    types.map((type) => [type, gradeAxes(resolveStoneGrades(input, type))]),
  );

  for (const metal of metals) {
    for (const purity of purities) {
      for (const color of colors) {
        if (!isValidCombination(metal, purity, color)) continue;
        for (const diamondType of types) {
          for (const grade of gradesByType.get(diamondType) ?? []) {
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
  const specs = generateVariationSpecs(session);

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
