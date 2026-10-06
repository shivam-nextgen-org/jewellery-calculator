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
export type GoldColorOption = "yellow" | "white" | "rose" | "sterling";

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

/** How diamond color/clarity % adjustments combine against base ₹/ct. */
export type PricingCalculationMethod = "additive" | "sequential";

export type PricingProfileStatus = "active" | "archived";

export interface PricingGradeRule {
  grade: string;
  /** Signed percentage (20 = +20%, -10 = −10%). */
  adjustmentPercent: number;
}

/** Per-user configurable diamond pricing rule set. */
export interface PricingProfile {
  id: string;
  userId: string;
  name: string;
  stoneType: DiamondTypeOption;
  status: PricingProfileStatus;
  basePricePerCt: number;
  baseCurrency: "INR";
  baseColorGrade: string;
  baseClarityGrade: string;
  calculationMethod: PricingCalculationMethod;
  colorRules: PricingGradeRule[];
  clarityRules: PricingGradeRule[];
  isDefault: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingProfileInput {
  name: string;
  stoneType: DiamondTypeOption;
  basePricePerCt: number;
  baseColorGrade: string;
  baseClarityGrade: string;
  calculationMethod: PricingCalculationMethod;
  colorRules: PricingGradeRule[];
  clarityRules: PricingGradeRule[];
  isDefault?: boolean;
  /** Optimistic concurrency — ISO string from last load. */
  updatedAt?: string;
}

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
  /** Pure (999) silver rate ₹/gram. Silver purities (925/958/999) price off this. */
  silverRate: number;
  purityPercentages: Record<GoldPurityOption, number>;
  /** @deprecated use defaultDiamondRateNatural — kept for older saved settings */
  defaultDiamondRate: number;
  defaultDiamondRateNatural: number;
  defaultDiamondRateLabGrown: number;
  /** Moissanite rate (₹ / CT) — same pattern as natural / lab-grown. */
  defaultDiamondRateMoissanite: number;
  /** Default diamond color grade for new pricing sessions (e.g. G). */
  defaultDiamondColorGrade: string;
  /** Default diamond clarity grade for new pricing sessions (e.g. VS1). */
  defaultDiamondClarityGrade: string;
  /**
   * @deprecated use defaultDiamondDiscountNatural / LabGrown / Moissanite.
   * Kept so older saved settings still load; parsePricingDefaults migrates it.
   */
  defaultDiamondDiscount: number;
  defaultDiamondDiscountNatural: number;
  defaultDiamondDiscountLabGrown: number;
  defaultDiamondDiscountMoissanite: number;
  defaultMakingCharge: number;
  defaultMakingCalcType: ChargeCalcType;
  defaultOtherCharge: number;
  defaultOtherCalcType: ChargeCalcType;
  /** ISO timestamp when gold24kRate was last refreshed from live market (optional). */
  goldRateLastUpdatedAt?: string | null;
  /** ISO timestamp when silverRate was last refreshed from live market (optional). */
  silverRateLastUpdatedAt?: string | null;
}

/** Colour / clarity grades picked for one stone type. */
export interface StoneGradeSelection {
  /** Colour grades on that stone's own scale (D–M, or Colorless/Warm). */
  colors: string[];
  /** Clarity grades on that stone's own scale (FL–I3, or FL/IF–SI). */
  clarities: string[];
}

export type StoneGradeSelectionMap = Partial<
  Record<DiamondTypeOption, StoneGradeSelection>
>;

export interface VariationSelection {
  metals: GoldMetalOption[];
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
  diamondTypes: DiamondTypeOption[];
  /**
   * Grades per stone type — GIA grades for natural / lab-grown, commercial
   * bands for moissanite. Never shared, so a moissanite band can't produce a
   * natural diamond row.
   */
  stoneGrades: StoneGradeSelectionMap;
  /**
   * @deprecated Global grade axes from older drafts. Read by
   * migrateVariationSelection() and folded into {@link stoneGrades}.
   */
  diamondColors?: string[];
  /** @deprecated See {@link diamondColors}. */
  diamondClarities?: string[];
}

export interface PricingFormState {
  gold24kRate: number;
  silverRate: number;
  diamondShape: DiamondShapeOption;
  diamondRateNatural: number;
  diamondRateLabGrown: number;
  diamondRateMoissanite: number;
  /**
   * @deprecated use diamondDiscountNatural / LabGrown / Moissanite.
   * Kept for older pricing drafts; prefer the per-stone fields.
   */
  diamondDiscount: number;
  diamondDiscountNatural: number;
  diamondDiscountLabGrown: number;
  diamondDiscountMoissanite: number;
  makingCharge: number;
  makingCalcType: ChargeCalcType;
  otherCharges: OtherCharge[];
  /** Diamond color grade for profile-based ₹/ct (session-level, not a variation axis). */
  diamondColorGrade?: string;
  /** Diamond clarity grade for profile-based ₹/ct. */
  diamondClarityGrade?: string;
  /** Profile ids used to resolve rates per stone type. */
  diamondProfileIdNatural?: string | null;
  diamondProfileIdLabGrown?: string | null;
  diamondProfileIdMoissanite?: string | null;
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
