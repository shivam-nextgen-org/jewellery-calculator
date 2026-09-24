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

export interface PricingSessionInput {
  netWeight: DecimalInput;
  diamondWeight: DecimalInput;
  gold24kRate: DecimalInput;
  purityPercentages: Partial<Record<GoldPurityOption, DecimalInput>>;
  metals: GoldMetalOption[];
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
  diamondTypes: import("@/types/jewellery").DiamondTypeOption[];
  diamondRateNatural: DecimalInput;
  diamondRateLabGrown: DecimalInput;
  diamondDiscountPercent: DecimalInput;
  makingCharge: DecimalInput;
  makingCalcType: ChargeCalcType;
  otherCharges: ChargeInput[];
  /** Per-variation overrides keyed by variation id. */
  overridesByVariationId?: Record<string, VariationOverrides>;
}
