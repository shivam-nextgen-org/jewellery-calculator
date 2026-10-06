import { describe, expect, it } from "vitest";
import {
  calculateAllVariations,
  countVariations,
  discountPercentForDiamondType,
  generateVariationSpecs,
  isValidCombination,
} from "./variations";
import type { GoldPurityOption } from "@/types/jewellery";

const percentages = {
  "9K": 37.5, "10K": 41.7, "14K": 58.5, "18K": 75, "22K": 91.6, "24K": 99.9,
  "925": 92.5, "958": 95.8, "999": 99.9,
} as Record<GoldPurityOption, number>;

describe("metal / purity / colour combinations", () => {
  it("pairs silver purities with silver colours and karats with gold colours", () => {
    expect(isValidCombination("gold", "22K", "yellow")).toBe(true);
    expect(isValidCombination("silver", "925", "sterling")).toBe(true);
    expect(isValidCombination("gold", "925", "yellow")).toBe(false);
    expect(isValidCombination("gold", "22K", "sterling")).toBe(false);
    expect(isValidCombination("silver", "22K", "sterling")).toBe(false);
    expect(isValidCombination("silver", "925", "rose")).toBe(false);
  });

  it("a mixed gold + silver selection only produces real variations", () => {
    const specs = generateVariationSpecs(
      ["gold", "silver"],
      ["22K", "925"],
      ["yellow", "white", "rose", "sterling"],
      ["natural", "lab-grown"],
      10000, percentages, 5000, 2000, 0, 100,
    );
    const combos = specs.map((s) => `${s.metal}-${s.purity}-${s.color}`);
    expect(new Set(combos)).toEqual(
      new Set(["gold-22K-yellow", "gold-22K-white", "gold-22K-rose", "silver-925-sterling"]),
    );
    expect(specs).toHaveLength(8);
    expect(specs.find((s) => s.purity === "925")).toMatchObject({ metalLabel: "Silver", colorLabel: "Sterling Silver" });
    expect(countVariations(["gold", "silver"], ["22K", "925"], ["yellow", "white", "rose", "sterling"], ["natural", "lab-grown"])).toBe(8);
  });

  it("gold-only selections are unchanged", () => {
    expect(countVariations(["gold"], ["18K", "22K"], ["yellow", "white"], ["natural"])).toBe(4);
  });

  it("multiplies by selected diamond colour × clarity grades", () => {
    const specs = generateVariationSpecs(
      ["gold"],
      ["18K"],
      ["yellow"],
      ["natural"],
      10000,
      percentages,
      1_000_000,
      45000,
      8000,
      0,
      ["G", "D"],
      ["VS1", "VVS1"],
      {
        natural: {
          calculationMethod: "additive",
          colorRules: [
            { grade: "G", adjustmentPercent: 0 },
            { grade: "D", adjustmentPercent: 20 },
          ],
          clarityRules: [
            { grade: "VS1", adjustmentPercent: 0 },
            { grade: "VVS1", adjustmentPercent: 25 },
          ],
        },
      },
    );
    expect(specs).toHaveLength(4);
    expect(specs.map((s) => s.label).sort()).toEqual([
      "18K Yellow · Natural · D-VS1",
      "18K Yellow · Natural · D-VVS1",
      "18K Yellow · Natural · G-VS1",
      "18K Yellow · Natural · G-VVS1",
    ].sort());
    const dvs1 = specs.find((s) => s.diamondColorGrade === "D" && s.diamondClarityGrade === "VVS1");
    expect(dvs1?.diamondRate).toBe("1450000.00");
    expect(
      countVariations(
        ["gold"],
        ["18K"],
        ["yellow"],
        ["natural"],
        ["G", "D"],
        ["VS1", "VVS1"],
      ),
    ).toBe(4);
  });
});

describe("per-stone diamond discounts", () => {
  it("resolves discount by stone type with legacy fallback", () => {
    expect(
      discountPercentForDiamondType(
        {
          diamondDiscountPercentNatural: 20,
          diamondDiscountPercentLabGrown: 10,
          diamondDiscountPercentMoissanite: 5,
        },
        "natural",
      ),
    ).toBe(20);
    expect(
      discountPercentForDiamondType(
        {
          diamondDiscountPercentNatural: 20,
          diamondDiscountPercentLabGrown: 10,
          diamondDiscountPercentMoissanite: 5,
        },
        "lab-grown",
      ),
    ).toBe(10);
    expect(
      discountPercentForDiamondType(
        { diamondDiscountPercent: 15 },
        "moissanite",
      ),
    ).toBe(15);
  });

  it("applies a different discount to natural vs lab-grown variations", () => {
    const rows = calculateAllVariations({
      netWeight: 1,
      diamondWeight: 1,
      gold24kRate: 10000,
      silverRate: 90,
      purityPercentages: { "18K": 75 },
      metals: ["gold"],
      purities: ["18K"],
      colors: ["yellow"],
      diamondTypes: ["natural", "lab-grown"],
      diamondRateNatural: 100_000,
      diamondRateLabGrown: 100_000,
      diamondRateMoissanite: 8000,
      diamondDiscountPercentNatural: 20,
      diamondDiscountPercentLabGrown: 0,
      diamondDiscountPercentMoissanite: 0,
      makingCharge: 0,
      makingCalcType: "fixed",
      otherCharges: [],
    });

    const natural = rows.find((r) => r.diamondType === "natural");
    const lab = rows.find((r) => r.diamondType === "lab-grown");
    expect(natural?.calculation.breakdown.diamondDiscountPercent).toBe("20");
    expect(lab?.calculation.breakdown.diamondDiscountPercent).toBe("0");
    expect(natural?.calculation.diamondDiscountAmount).toBe("20000.00");
    expect(lab?.calculation.diamondDiscountAmount).toBe("0.00");
  });
});
