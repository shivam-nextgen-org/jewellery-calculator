import type {
  DiamondTypeOption,
  PricingCalculationMethod,
  PricingGradeRule,
  PricingProfileInput,
} from "@/types/jewellery";

export class PricingProfileValidationError extends Error {
  field?: string;
  status?: number;
  constructor(message: string, field?: string, status?: number) {
    super(message);
    this.field = field;
    this.status = status;
  }
}

const STONE_TYPES: DiamondTypeOption[] = ["natural", "lab-grown", "moissanite"];
const METHODS: PricingCalculationMethod[] = ["additive", "sequential"];

function normalizeGrade(grade: string): string {
  return grade.trim();
}

function validateRules(
  rules: PricingGradeRule[],
  field: "colorRules" | "clarityRules",
  baseGrade: string,
): PricingGradeRule[] {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new PricingProfileValidationError(
      "At least one pricing rule is required.",
      field,
    );
  }

  const seen = new Set<string>();
  const normalized: PricingGradeRule[] = [];

  for (const rule of rules) {
    const grade = normalizeGrade(String(rule?.grade ?? ""));
    if (!grade) {
      throw new PricingProfileValidationError(
        "Every rule must have a grade name.",
        field,
      );
    }
    if (seen.has(grade)) {
      throw new PricingProfileValidationError(
        `Duplicate ${field === "colorRules" ? "color" : "clarity"} grade: ${grade}.`,
        field,
      );
    }
    seen.add(grade);
    const pct = Number(rule.adjustmentPercent);
    if (!Number.isFinite(pct)) {
      throw new PricingProfileValidationError(
        `Please enter a valid percentage for ${grade}.`,
        field,
      );
    }
    // Technical bound only — unusual business values like +500% are allowed within this.
    if (pct < -1000 || pct > 1000) {
      throw new PricingProfileValidationError(
        `Percentage for ${grade} must be between -1000 and 1000.`,
        field,
      );
    }
    normalized.push({ grade, adjustmentPercent: pct });
  }

  const base = normalizeGrade(baseGrade);
  if (!seen.has(base)) {
    throw new PricingProfileValidationError(
      field === "colorRules"
        ? "Please select a base color that exists in the color rules."
        : "Please select a base clarity that exists in the clarity rules.",
      field === "colorRules" ? "baseColorGrade" : "baseClarityGrade",
    );
  }

  const baseRule = normalized.find((r) => r.grade === base)!;
  if (baseRule.adjustmentPercent !== 0) {
    throw new PricingProfileValidationError(
      field === "colorRules"
        ? `${base} must remain at 0% because it is the base color.`
        : `${base} must remain at 0% because it is the base clarity.`,
      field,
    );
  }

  return normalized;
}

export function validatePricingProfileInput(
  input: PricingProfileInput,
): PricingProfileInput {
  const name = String(input.name ?? "").trim();
  if (!name) {
    throw new PricingProfileValidationError(
      "Please enter a profile name.",
      "name",
    );
  }
  if (name.length > 120) {
    throw new PricingProfileValidationError(
      "Profile name must be 120 characters or fewer.",
      "name",
    );
  }

  if (!STONE_TYPES.includes(input.stoneType)) {
    throw new PricingProfileValidationError(
      "Please select a valid stone type.",
      "stoneType",
    );
  }

  const basePricePerCt = Number(input.basePricePerCt);
  if (!Number.isFinite(basePricePerCt) || basePricePerCt < 0) {
    throw new PricingProfileValidationError(
      "Please enter a valid base price.",
      "basePricePerCt",
    );
  }

  const baseColorGrade = normalizeGrade(String(input.baseColorGrade ?? ""));
  if (!baseColorGrade) {
    throw new PricingProfileValidationError(
      "Please select a base color.",
      "baseColorGrade",
    );
  }

  const baseClarityGrade = normalizeGrade(String(input.baseClarityGrade ?? ""));
  if (!baseClarityGrade) {
    throw new PricingProfileValidationError(
      "Please select a base clarity.",
      "baseClarityGrade",
    );
  }

  const calculationMethod: PricingCalculationMethod = METHODS.includes(
    input.calculationMethod,
  )
    ? input.calculationMethod
    : "additive";

  const colorRules = validateRules(
    input.colorRules,
    "colorRules",
    baseColorGrade,
  );
  const clarityRules = validateRules(
    input.clarityRules,
    "clarityRules",
    baseClarityGrade,
  );

  return {
    name,
    stoneType: input.stoneType,
    basePricePerCt,
    baseColorGrade,
    baseClarityGrade,
    calculationMethod,
    colorRules,
    clarityRules,
    isDefault: Boolean(input.isDefault),
    updatedAt: input.updatedAt,
  };
}
