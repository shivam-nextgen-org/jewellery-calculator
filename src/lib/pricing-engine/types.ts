import type {
  ChargeCalcType,
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
} from "@/types/jewellery";
import type { DecimalInput } from "./decimal";

export interface ChargeInput {
  id: string;
  name: string;
  amount: DecimalInput;
  calcType: ChargeCalcType;
}

export interface CalculateJewelleryPriceInput {
  netWeight: DecimalInput;
  goldRatePerGram: DecimalInput;
  diamondWeight: DecimalInput;
  diamondRate: DecimalInput;
  diamondDiscountPercent: DecimalInput;
  makingCharge: DecimalInput;
  makingCalcType: ChargeCalcType;
  otherCharges: ChargeInput[];
  /** Optional manual overrides — applied after engine calc. */
  overrides?: VariationOverrides;
}

export interface ChargeLineResult {
  id: string;
  name: string;
  calcType: ChargeCalcType;
  inputAmount: string;
  calculatedAmount: string;
}

export interface CalculateJewelleryPriceResult {
  goldPrice: string;
  diamondGrossPrice: string;
  diamondDiscountAmount: string;
  diamondFinalPrice: string;
  makingCharge: string;
  otherCharges: ChargeLineResult[];
  otherChargesTotal: string;
  subtotal: string;
  finalPrice: string;
  breakdown: PricingBreakdown;
  appliedOverrides: AppliedOverrides;
}

export interface PricingBreakdown {
  netWeight: string;
  goldRatePerGram: string;
  goldFormula: string;
  diamondWeight: string;
  diamondRate: string;
  diamondGrossFormula: string;
  diamondDiscountPercent: string;
  diamondDiscountFormula: string;
  makingFormula: string;
  otherLines: { name: string; formula: string; amount: string }[];
}

export interface VariationOverrides {
  makingCharge?: DecimalInput | null;
  diamondDiscountPercent?: DecimalInput | null;
  otherChargesTotal?: DecimalInput | null;
  finalPrice?: DecimalInput | null;
}

export interface AppliedOverrides {
  makingCharge: boolean;
  diamondDiscountPercent: boolean;
  otherChargesTotal: boolean;
  finalPrice: boolean;
}

export interface VariationSpec {
  id: string;
  metal: GoldMetalOption;
  metalLabel: string;
  purity: GoldPurityOption;
  color: GoldColorOption;
  colorLabel: string;
  diamondType: import("@/types/jewellery").DiamondTypeOption;
  diamondTypeLabel: string;
  /** Diamond colour grade when colour×clarity variations are enabled. */
  diamondColorGrade: string | null;
  /** Diamond clarity grade when colour×clarity variations are enabled. */
  diamondClarityGrade: string | null;
  label: string;
  goldRatePerGram: string;
  goldPurityPercent: string;
  diamondRate: string;
}

export interface PricedVariation extends VariationSpec {
  calculation: CalculateJewelleryPriceResult;
  hasManualOverride: boolean;
}

export interface PricingValidationIssue {
  field: string;
  message: string;
}

/** Per-stone-type colour/clarity % rules used when building variations. */
export interface DiamondGradeProfileInput {
  calculationMethod: import("@/types/jewellery").PricingCalculationMethod;
  colorRules: import("@/types/jewellery").PricingGradeRule[];
  clarityRules: import("@/types/jewellery").PricingGradeRule[];
}

/** Grade adjustment rules keyed by stone type. */
export type DiamondGradeProfileMap = Partial<
  Record<import("@/types/jewellery").DiamondTypeOption, DiamondGradeProfileInput>
>;

/**
 * Which metal / purity / colour and stone grades the variation matrix spans.
 * Grades are stored per stone type so each scale stays on its own stone.
 */
export interface VariationMatrixInput {
  metals: GoldMetalOption[];
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
  diamondTypes: import("@/types/jewellery").DiamondTypeOption[];
  /** Selected colour / clarity grades keyed by stone type. */
  stoneGrades?: import("@/types/jewellery").StoneGradeSelectionMap;
  /**
   * @deprecated Global grade axes from older drafts. Applied to a stone type
   * only for the grades that exist on that stone's scale.
   */
  diamondColors?: string[];
  /** @deprecated See {@link diamondColors}. */
  diamondClarities?: string[];
  diamondGradeByType?: DiamondGradeProfileMap;
}

/** Variation count split the way the config panel reads it. */
export interface VariationBreakdown {
  /** Real metal × purity × colour pairings. */
  metalCombinations: number;
  /** Price rows every selected stone type adds per metal combination. */
  stoneRows: number;
  rowsByStoneType: Partial<
    Record<import("@/types/jewellery").DiamondTypeOption, number>
  >;
  total: number;
}

/** Everything {@link VariationSpec} generation needs — matrix plus rates. */
export interface VariationSpecInput extends VariationMatrixInput {
  gold24kRate: DecimalInput;
  /** Pure (999) silver rate ₹/gram — used for silver purities (925/958/999). */
  silverRate?: DecimalInput;
  purityPercentages: Partial<Record<GoldPurityOption, DecimalInput>>;
  diamondRateNatural: DecimalInput;
  diamondRateLabGrown: DecimalInput;
  diamondRateMoissanite?: DecimalInput;
}

export interface PricingSessionInput extends VariationSpecInput {
  netWeight: DecimalInput;
  diamondWeight: DecimalInput;
  silverRate: DecimalInput;
  diamondRateMoissanite: DecimalInput;
  /**
   * @deprecated Prefer per-stone discount fields. Used as fallback when a
   * per-stone value is missing (older drafts / callers).
   */
  diamondDiscountPercent?: DecimalInput;
  diamondDiscountPercentNatural?: DecimalInput;
  diamondDiscountPercentLabGrown?: DecimalInput;
  diamondDiscountPercentMoissanite?: DecimalInput;
  makingCharge: DecimalInput;
  makingCalcType: ChargeCalcType;
  otherCharges: ChargeInput[];
  /** Per-variation overrides keyed by variation id. */
  overridesByVariationId?: Record<string, VariationOverrides>;
}
