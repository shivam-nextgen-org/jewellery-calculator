export type PricingStep = "import" | "verify" | "price" | "variations" | "review";

export type GoldMetalOption = "gold" | "silver" | "platinum";
export type GoldPurityOption =
  | "9K"
  | "10K"
  | "14K"
  | "18K"
  | "22K"
  | "24K"
  | "925"
  | "999"
  | "958";
export type GoldColorOption = "yellow" | "white" | "rose";

export type DiamondTypeOption = "natural" | "lab-grown" | "moissanite";
export type DiamondShapeOption =
  | "round"
  | "princess"
  | "oval"
  | "pear"
  | "marquise"
  | "emerald"
  | "cushion";

export type ChargeCalcType = "per-gram" | "fixed" | "percentage";

export interface JewelleryExtractedData {
  designNo: string;
  category: string;
  goldCode: string;
  goldMetal: string;
  goldPurity: string;
  goldColor: string;
  grossWeight: number;
  netWeight: number;
  pureWeight: number;
  size: string;
  diamondWeight: number;
  diamondShape: string;
  diamondType: string;
  diamondPurity: string;
  diamondPieces: number;
  certified: string;
  certificatePrice: number | null;
}

export interface GoldPurityRate {
  purity: GoldPurityOption;
  percentage: number;
  ratePerGram: number;
}

export interface OtherCharge {
  id: string;
  name: string;
  amount: number;
  calcType: ChargeCalcType;
}

export interface PricingDefaults {
  gold24kRate: number;
  purityPercentages: Record<GoldPurityOption, number>;
  /** @deprecated use defaultDiamondRateNatural — kept for older saved settings */
  defaultDiamondRate: number;
  defaultDiamondRateNatural: number;
  defaultDiamondRateLabGrown: number;
  /** Moissanite rate (₹ / CT) — same pattern as natural / lab-grown. */
  defaultDiamondRateMoissanite: number;
  defaultDiamondDiscount: number;
  defaultMakingCharge: number;
  defaultMakingCalcType: ChargeCalcType;
  defaultOtherCharge: number;
  defaultOtherCalcType: ChargeCalcType;
  /** ISO timestamp when gold24kRate was last refreshed from live market (optional). */
  goldRateLastUpdatedAt?: string | null;
}

export interface VariationSelection {
  metals: GoldMetalOption[];
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
  diamondTypes: DiamondTypeOption[];
}

export interface PricingFormState {
  gold24kRate: number;
  diamondShape: DiamondShapeOption;
  diamondRateNatural: number;
  diamondRateLabGrown: number;
  diamondRateMoissanite: number;
  diamondDiscount: number;
  makingCharge: number;
  makingCalcType: ChargeCalcType;
  otherCharges: OtherCharge[];
}

export interface DashboardStats {
  totalDesigns: number;
  todaysImports: number;
  calculatedProducts: number;
  totalVariations: number;
  current24kGoldRate: number;
}

export interface RecentDesign {
  id: string;
  designNo: string;
  category: string;
  variationCount: number;
  priceMin: number;
  priceMax: number;
  updatedAt: string;
}
