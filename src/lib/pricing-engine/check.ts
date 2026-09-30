/**
 * Quick sanity check for the pricing engine.
 * Run: npx tsx src/lib/pricing-engine/check.ts
 */
import {
  calculateAllVariations,
  calculateJewelleryPrice,
  validatePricingSession,
} from "./index";

const result = calculateJewelleryPrice({
  netWeight: 1.932,
  goldRatePerGram: 4167,
  diamondWeight: 1.44,
  diamondRate: 100000,
  diamondDiscountPercent: 20,
  makingCharge: 500,
  makingCalcType: "per-gram",
  otherCharges: [
    { id: "1", name: "Certification", amount: 500, calcType: "fixed" },
  ],
});

console.log("Single variation:", {
  goldPrice: result.goldPrice,
  diamondFinal: result.diamondFinalPrice,
  making: result.makingCharge,
  other: result.otherChargesTotal,
  final: result.finalPrice,
});

const rows = calculateAllVariations({
  netWeight: 1.932,
  diamondWeight: 1.44,
  gold24kRate: 10000,
  silverRate: 90,
  purityPercentages: { "10K": 41.67, "14K": 58.33, "18K": 75 },
  metals: ["gold"],
  purities: ["10K", "14K", "18K"],
  colors: ["yellow", "white", "rose"],
  diamondTypes: ["natural", "lab-grown"],
  diamondRateNatural: 100000,
  diamondRateLabGrown: 45000,
  diamondRateMoissanite: 8000,
  diamondDiscountPercent: 20,
  makingCharge: 500,
  makingCalcType: "per-gram",
  otherCharges: [
    { id: "1", name: "Certification", amount: 500, calcType: "fixed" },
  ],
});

console.log("Variations:", rows.length);
console.log(
  "10K Yellow Natural final:",
  rows.find((r) => r.id === "gold-10K-yellow-natural")?.calculation.finalPrice,
);
console.log(
  "10K Yellow Lab Grown final:",
  rows.find((r) => r.id === "gold-10K-yellow-lab-grown")?.calculation
    .finalPrice,
);

const issues = validatePricingSession({
  netWeight: 1,
  diamondWeight: 1,
  gold24kRate: 10000,
  silverRate: 90,
  purityPercentages: { "10K": 41.67 },
  metals: [],
  purities: ["10K"],
  colors: ["yellow"],
  diamondTypes: [],
  diamondRateNatural: 100000,
  diamondRateLabGrown: 45000,
  diamondRateMoissanite: 8000,
  diamondDiscountPercent: 120,
  makingCharge: 500,
  makingCalcType: "per-gram",
  otherCharges: [],
});

console.log(
  "Validation issues:",
  issues.map((i) => i.message),
);
