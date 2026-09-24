import type {
  DashboardStats,
  JewelleryExtractedData,
  PricingDefaults,
  RecentDesign,
} from "@/types/jewellery";

export const MOCK_EXTRACTED: JewelleryExtractedData = {
  designNo: "LR-0003",
  category: "Ladies Ring",
  goldCode: "G10Y",
  goldMetal: "Gold",
  goldPurity: "10K",
  goldColor: "Yellow Gold",
  grossWeight: 2.22,
  netWeight: 1.932,
  pureWeight: 0.83,
  size: "7",
  diamondWeight: 1.44,
  diamondShape: "Round",
  diamondType: "Natural",
  diamondPurity: "RND",
  diamondPieces: 28,
  certified: "Natural",
  certificatePrice: null,
};

export const MOCK_PRICING_DEFAULTS: PricingDefaults = {
  gold24kRate: 10000,
  purityPercentages: {
    "24K": 100,
    "22K": 91.67,
    "18K": 75,
    "14K": 58.33,
    "10K": 41.67,
    "9K": 37.5,
    "925": 92.5,
    "999": 99.9,
    "958": 95.8,
  },
  defaultDiamondRate: 100000,
  defaultDiamondRateNatural: 100000,
  defaultDiamondRateLabGrown: 45000,
  defaultDiamondDiscount: 20,
  defaultMakingCharge: 500,
  defaultMakingCalcType: "per-gram",
  defaultOtherCharge: 500,
  defaultOtherCalcType: "fixed",
};

export const MOCK_DASHBOARD_STATS: DashboardStats = {
  totalDesigns: 128,
  todaysImports: 6,
  calculatedProducts: 94,
  totalVariations: 612,
  current24kGoldRate: 10000,
};

export const MOCK_RECENT_DESIGNS: RecentDesign[] = [
  {
    id: "1",
    designNo: "LR-0003",
    category: "Ladies Ring",
    variationCount: 9,
    priceMin: 118420,
    priceMax: 132850,
    updatedAt: "Today, 9:12 AM",
  },
  {
    id: "2",
    designNo: "ER-0142",
    category: "Earrings",
    variationCount: 6,
    priceMin: 84200,
    priceMax: 96800,
    updatedAt: "Yesterday",
  },
  {
    id: "3",
    designNo: "PN-0088",
    category: "Pendant",
    variationCount: 12,
    priceMin: 56200,
    priceMax: 71450,
    updatedAt: "2 days ago",
  },
  {
    id: "4",
    designNo: "BR-0031",
    category: "Bracelet",
    variationCount: 9,
    priceMin: 210400,
    priceMax: 248900,
    updatedAt: "3 days ago",
  },
];

/** @deprecated Use buildPurityRateTable from pricing-engine */
export { buildPurityRateTable as computePurityRates } from "@/lib/pricing-engine";
