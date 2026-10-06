import { describe, expect, it } from "vitest";
import { previewPricingProfile } from "@/lib/services/pricing-profiles";
import type { PricingProfile } from "@/types/jewellery";

const sampleProfile: Pick<
  PricingProfile,
  | "basePricePerCt"
  | "colorRules"
  | "clarityRules"
  | "calculationMethod"
  | "baseCurrency"
> = {
  basePricePerCt: 1_000_000,
  baseCurrency: "INR",
  calculationMethod: "additive",
  colorRules: [
    { grade: "D", adjustmentPercent: 20 },
    { grade: "G", adjustmentPercent: 0 },
  ],
  clarityRules: [
    { grade: "VVS1", adjustmentPercent: 25 },
    { grade: "VS1", adjustmentPercent: 0 },
  ],
};

describe("previewPricingProfile", () => {
  it("returns additive breakdown and carat total", () => {
    const preview = previewPricingProfile(sampleProfile, {
      colorGrade: "D",
      clarityGrade: "VVS1",
      carat: 1.5,
    });
    expect(preview.ratePerCt).toBe(1_450_000);
    expect(preview.totalAdjustmentPercent).toBe(45);
    expect(preview.totalPrice).toBe(2_175_000);
    expect(preview.calculationMethod).toBe("additive");
  });

  it("supports sequential method", () => {
    const preview = previewPricingProfile(
      { ...sampleProfile, calculationMethod: "sequential" },
      { colorGrade: "D", clarityGrade: "VVS1", carat: 1 },
    );
    expect(preview.ratePerCt).toBe(1_500_000);
  });
});
