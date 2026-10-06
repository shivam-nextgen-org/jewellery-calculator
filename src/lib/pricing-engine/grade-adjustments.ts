import { d, money, rate, type DecimalInput } from "./decimal";

/** How percentage adjustments combine against a base price. */
export type PricingCalculationMethod = "additive" | "sequential";

export interface PricingGradeRule {
  grade: string;
  /** Signed percentage, e.g. 20 = +20%, -10 = −10%. Never store a "+" prefix. */
  adjustmentPercent: number;
}

export interface CalculateAdjustedRateInput {
  basePricePerCt: DecimalInput;
  /** Ordered list of adjustment percentages to apply (color, clarity, …). */
  adjustments: DecimalInput[];
  calculationMethod: PricingCalculationMethod;
}

export interface CalculateAdjustedRateResult {
  ratePerCt: string;
  totalAdjustmentPercent: string;
  method: PricingCalculationMethod;
}

/**
 * Additive: base × (1 + Σ pct / 100)
 * e.g. +20 and +25 → × 1.45
 */
export function calculateAdditiveRatePerCt(
  basePricePerCt: DecimalInput,
  adjustments: DecimalInput[],
) {
  let totalPct = d(0);
  for (const pct of adjustments) {
    totalPct = totalPct.add(d(pct));
  }
  const multiplier = d(1).add(totalPct.div(100));
  const ratePerCt = money(d(basePricePerCt).mul(multiplier));
  return {
    ratePerCt,
    totalAdjustmentPercent: rate(totalPct),
  };
}

/**
 * Sequential: base × Π (1 + pct / 100)
 * e.g. +20 then +25 → × 1.20 × 1.25
 */
export function calculateSequentialRatePerCt(
  basePricePerCt: DecimalInput,
  adjustments: DecimalInput[],
) {
  let result = d(basePricePerCt);
  let compoundFactor = d(1);
  for (const pct of adjustments) {
    const factor = d(1).add(d(pct).div(100));
    result = result.mul(factor);
    compoundFactor = compoundFactor.mul(factor);
  }
  const totalPct = compoundFactor.sub(1).mul(100);
  return {
    ratePerCt: money(result),
    totalAdjustmentPercent: rate(totalPct),
  };
}

export function calculateAdjustedRatePerCt(
  input: CalculateAdjustedRateInput,
): CalculateAdjustedRateResult {
  const method = input.calculationMethod === "sequential" ? "sequential" : "additive";
  const computed =
    method === "sequential"
      ? calculateSequentialRatePerCt(input.basePricePerCt, input.adjustments)
      : calculateAdditiveRatePerCt(input.basePricePerCt, input.adjustments);

  return {
    ratePerCt: computed.ratePerCt.toFixed(2),
    totalAdjustmentPercent: computed.totalAdjustmentPercent.toFixed(4),
    method,
  };
}

/** Build a grade → percent map; last duplicate wins (validation should reject duplicates). */
export function resolveAdjustmentMap(
  rules: PricingGradeRule[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const rule of rules) {
    const grade = rule.grade.trim();
    if (!grade) continue;
    map.set(grade, Number(rule.adjustmentPercent) || 0);
  }
  return map;
}

export function lookupAdjustmentPercent(
  rules: PricingGradeRule[],
  grade: string | null | undefined,
): number {
  if (!grade) return 0;
  const map = resolveAdjustmentMap(rules);
  const found = map.get(grade.trim());
  return found ?? 0;
}

/**
 * Resolve effective ₹/ct from a profile-like shape for a color + clarity selection.
 */
export function calculateRateFromGradeProfile(input: {
  basePricePerCt: DecimalInput;
  colorRules: PricingGradeRule[];
  clarityRules: PricingGradeRule[];
  colorGrade: string | null | undefined;
  clarityGrade: string | null | undefined;
  calculationMethod: PricingCalculationMethod;
}): CalculateAdjustedRateResult & {
  colorAdjustmentPercent: number;
  clarityAdjustmentPercent: number;
} {
  const colorAdjustmentPercent = lookupAdjustmentPercent(
    input.colorRules,
    input.colorGrade,
  );
  const clarityAdjustmentPercent = lookupAdjustmentPercent(
    input.clarityRules,
    input.clarityGrade,
  );
  const result = calculateAdjustedRatePerCt({
    basePricePerCt: input.basePricePerCt,
    adjustments: [colorAdjustmentPercent, clarityAdjustmentPercent],
    calculationMethod: input.calculationMethod,
  });
  return {
    ...result,
    colorAdjustmentPercent,
    clarityAdjustmentPercent,
  };
}

/** Parse UI percentage input: "+20", "20", "-10", "12.5%" → number. */
export function parsePercentageInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  const trimmed = raw.trim().replace(/%/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function formatAdjustmentPercent(value: number): string {
  if (value > 0) return `+${value}%`;
  if (value < 0) return `${value}%`;
  return "0%";
}
