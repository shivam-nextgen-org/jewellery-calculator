import type { DiamondTypeOption } from "@/types/jewellery";
import type { PricingGradeRule } from "./grade-adjustments";

/** Standard diamond color grades (D–Z subset used commercially). */
export const DIAMOND_COLOR_GRADES = [
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
] as const;

/** Full clarity scale for natural and lab-grown diamonds. */
export const DIAMOND_CLARITY_GRADES = [
  "FL",
  "IF",
  "VVS1",
  "VVS2",
  "VS1",
  "VS2",
  "SI1",
  "SI2",
  "I1",
  "I2",
  "I3",
] as const;

/** Commercial Moissanite grades — not forced into the diamond scale. */
export const MOISSANITE_COLOR_GRADES = [
  "Colorless",
  "Near Colorless",
  "Warm",
] as const;

export const MOISSANITE_CLARITY_GRADES = ["FL/IF", "VVS", "VS", "SI"] as const;

export const DEFAULT_DIAMOND_BASE_COLOR = "G";
export const DEFAULT_DIAMOND_BASE_CLARITY = "VS1";
export const DEFAULT_MOISSANITE_BASE_COLOR = "Colorless";
export const DEFAULT_MOISSANITE_BASE_CLARITY = "VS";

function zeroRules(grades: readonly string[]): PricingGradeRule[] {
  return grades.map((grade) => ({ grade, adjustmentPercent: 0 }));
}

export function defaultColorRulesForStoneType(
  stoneType: DiamondTypeOption,
): PricingGradeRule[] {
  if (stoneType === "moissanite") {
    return zeroRules(MOISSANITE_COLOR_GRADES);
  }
  return zeroRules(DIAMOND_COLOR_GRADES);
}

export function defaultClarityRulesForStoneType(
  stoneType: DiamondTypeOption,
): PricingGradeRule[] {
  if (stoneType === "moissanite") {
    return zeroRules(MOISSANITE_CLARITY_GRADES);
  }
  return zeroRules(DIAMOND_CLARITY_GRADES);
}

/** Colour grades that belong to a stone type's own scale. */
export function colorGradeScaleForStoneType(
  stoneType: DiamondTypeOption,
): readonly string[] {
  return stoneType === "moissanite"
    ? MOISSANITE_COLOR_GRADES
    : DIAMOND_COLOR_GRADES;
}

/** Clarity grades that belong to a stone type's own scale. */
export function clarityGradeScaleForStoneType(
  stoneType: DiamondTypeOption,
): readonly string[] {
  return stoneType === "moissanite"
    ? MOISSANITE_CLARITY_GRADES
    : DIAMOND_CLARITY_GRADES;
}

/**
 * True when a grade belongs to this stone type's scale — the guard that keeps
 * moissanite bands out of diamond rows and GIA grades out of moissanite rows.
 */
export function isGradeForStoneType(
  stoneType: DiamondTypeOption,
  axis: "color" | "clarity",
  grade: string,
): boolean {
  const scale =
    axis === "color"
      ? colorGradeScaleForStoneType(stoneType)
      : clarityGradeScaleForStoneType(stoneType);
  const needle = grade.trim().toLowerCase();
  return scale.some((g) => g.toLowerCase() === needle);
}

export function defaultBaseColorForStoneType(
  stoneType: DiamondTypeOption,
): string {
  return stoneType === "moissanite"
    ? DEFAULT_MOISSANITE_BASE_COLOR
    : DEFAULT_DIAMOND_BASE_COLOR;
}

export function defaultBaseClarityForStoneType(
  stoneType: DiamondTypeOption,
): string {
  return stoneType === "moissanite"
    ? DEFAULT_MOISSANITE_BASE_CLARITY
    : DEFAULT_DIAMOND_BASE_CLARITY;
}

export function defaultProfileNameForStoneType(
  stoneType: DiamondTypeOption,
): string {
  switch (stoneType) {
    case "lab-grown":
      return "Lab Diamond — Default";
    case "moissanite":
      return "Moissanite — Default";
    default:
      return "Natural Diamond — Default";
  }
}

export function stoneTypeLabel(stoneType: DiamondTypeOption): string {
  switch (stoneType) {
    case "lab-grown":
      return "Lab Grown";
    case "moissanite":
      return "Moissanite";
    default:
      return "Natural Diamond";
  }
}
