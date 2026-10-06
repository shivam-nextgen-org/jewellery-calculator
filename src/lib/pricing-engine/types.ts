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

export interface PricingSessionInput {
  netWeight: DecimalInput;
  diamondWeight: DecimalInput;
  gold24kRate: DecimalInput;
  /** Pure (999) silver rate ₹/gram — used for silver purities (925/958/999). */
  silverRate: DecimalInput;
  purityPercentages: Partial<Record<GoldPurityOption, DecimalInput>>;
  metals: GoldMetalOption[];
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
  diamondTypes: import("@/types/jewellery").DiamondTypeOption[];
  /** Selected diamond colour grades for the variation matrix (e.g. G, D). */
  diamondColors?: string[];
  /** Selected diamond clarity grades for the variation matrix (e.g. VS1, VVS1). */
  diamondClarities?: string[];
  /** Grade adjustment rules keyed by stone type. */
  diamondGradeByType?: Partial<
    Record<
      import("@/types/jewellery").DiamondTypeOption,
      DiamondGradeProfileInput
    >
  >;
  diamondRateNatural: DecimalInput;
  diamondRateLabGrown: DecimalInput;
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
