import { describe, expect, it } from "vitest";
import {
  calculateAllVariations,
  countVariations,
  discountPercentForDiamondType,
  generateVariationSpecs,
  isValidCombination,
  resolveStoneGrades,
  variationBreakdown,
} from "./variations";
import type { VariationMatrixInput, VariationSpecInput } from "./types";
import type { GoldPurityOption } from "@/types/jewellery";

const percentages = {
  "9K": 37.5, "10K": 41.7, "14K": 58.5, "18K": 75, "22K": 91.6, "24K": 99.9,
  "925": 92.5, "958": 95.8, "999": 99.9,
} as Record<GoldPurityOption, number>;

const rates = {
  gold24kRate: 10000,
  silverRate: 100,
  purityPercentages: percentages,
  diamondRateNatural: 1_000_000,
  diamondRateLabGrown: 45000,
  diamondRateMoissanite: 8000,
};

function specInput(matrix: VariationMatrixInput): VariationSpecInput {
  return { ...rates, ...matrix };
}

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
    const matrix: VariationMatrixInput = {
      metals: ["gold", "silver"],
      purities: ["22K", "925"],
      colors: ["yellow", "white", "rose", "sterling"],
      diamondTypes: ["natural", "lab-grown"],
    };
    const specs = generateVariationSpecs(specInput(matrix));
    const combos = specs.map((s) => `${s.metal}-${s.purity}-${s.color}`);
    expect(new Set(combos)).toEqual(
      new Set(["gold-22K-yellow", "gold-22K-white", "gold-22K-rose", "silver-925-sterling"]),
    );
    expect(specs).toHaveLength(8);
    expect(specs.find((s) => s.purity === "925")).toMatchObject({ metalLabel: "Silver", colorLabel: "Sterling Silver" });
    expect(countVariations(matrix)).toBe(8);
  });

  it("gold-only selections are unchanged", () => {
    expect(
      countVariations({
        metals: ["gold"],
        purities: ["18K", "22K"],
        colors: ["yellow", "white"],
        diamondTypes: ["natural"],
      }),
    ).toBe(4);
  });

  it("multiplies by that stone's selected colour × clarity grades", () => {
    const matrix: VariationMatrixInput = {
      metals: ["gold"],
      purities: ["18K"],
      colors: ["yellow"],
      diamondTypes: ["natural"],
      stoneGrades: {
        natural: { colors: ["G", "D"], clarities: ["VS1", "VVS1"] },
      },
      diamondGradeByType: {
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
    };
    const specs = generateVariationSpecs(specInput(matrix));
    expect(specs).toHaveLength(4);
    expect(specs.map((s) => s.label).sort()).toEqual([
      "18K Yellow · Natural · D-VS1",
      "18K Yellow · Natural · D-VVS1",
      "18K Yellow · Natural · G-VS1",
      "18K Yellow · Natural · G-VVS1",
    ].sort());
    const dvs1 = specs.find((s) => s.diamondColorGrade === "D" && s.diamondClarityGrade === "VVS1");
    expect(dvs1?.diamondRate).toBe("1450000.00");
    expect(countVariations(matrix)).toBe(4);
  });
});

describe("per-stone grade axes", () => {
  const matrix: VariationMatrixInput = {
    metals: ["gold"],
    purities: ["18K"],
    colors: ["yellow"],
    diamondTypes: ["natural", "moissanite"],
    stoneGrades: {
      natural: { colors: ["G"], clarities: ["VS1", "VVS1"] },
      moissanite: { colors: ["Colorless", "Warm"], clarities: ["VS"] },
    },
  };

  it("adds each stone type's own grid instead of one shared grid", () => {
    // 1 metal combo × (natural 1×2 + moissanite 2×1)
    expect(countVariations(matrix)).toBe(4);
    expect(variationBreakdown(matrix)).toMatchObject({
      metalCombinations: 1,
      stoneRows: 4,
      rowsByStoneType: { natural: 2, moissanite: 2 },
      total: 4,
    });
  });

  it("never crosses moissanite bands with diamond grades", () => {
    const specs = generateVariationSpecs(specInput(matrix));
    expect(specs).toHaveLength(4);

    const naturalGrades = specs
      .filter((s) => s.diamondType === "natural")
      .map((s) => `${s.diamondColorGrade}-${s.diamondClarityGrade}`);
    expect(naturalGrades.sort()).toEqual(["G-VS1", "G-VVS1"]);

    const moissaniteGrades = specs
      .filter((s) => s.diamondType === "moissanite")
      .map((s) => `${s.diamondColorGrade}-${s.diamondClarityGrade}`);
    expect(moissaniteGrades.sort()).toEqual(["Colorless-VS", "Warm-VS"]);
  });

  it("drops grades that are not on the stone's own scale", () => {
    const crossed: VariationMatrixInput = {
      metals: ["gold"],
      purities: ["18K"],
      colors: ["yellow"],
      diamondTypes: ["natural", "moissanite"],
      stoneGrades: {
        // GIA grades wrongly assigned to moissanite, bands to natural.
        natural: { colors: ["Colorless"], clarities: ["VS"] },
        moissanite: { colors: ["G"], clarities: ["VS1"] },
      },
    };
    expect(resolveStoneGrades(crossed, "natural")).toEqual({
      colors: [],
      clarities: [],
    });
    expect(resolveStoneGrades(crossed, "moissanite")).toEqual({
      colors: [],
      clarities: [],
    });

    // Each stone still prices one row, at its own base rate, with no label.
    const specs = generateVariationSpecs(specInput(crossed));
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.label)).toEqual([
      "18K Yellow · Natural",
      "18K Yellow · Moissanite",
    ]);
    expect(specs.map((s) => s.diamondRate)).toEqual([
      "1000000.00",
      "8000.00",
    ]);
  });

  it("keeps a legacy global grade axis only on the stones that use it", () => {
    // v1 / v2 drafts stored one shared colour / clarity pair.
    const legacy: VariationMatrixInput = {
      metals: ["gold"],
      purities: ["18K"],
      colors: ["yellow"],
      diamondTypes: ["natural", "lab-grown", "moissanite"],
      diamondColors: ["G"],
      diamondClarities: ["VS1"],
    };
    expect(resolveStoneGrades(legacy, "lab-grown")).toEqual({
      colors: ["G"],
      clarities: ["VS1"],
    });
    expect(resolveStoneGrades(legacy, "moissanite")).toEqual({
      colors: [],
      clarities: [],
    });
    expect(countVariations(legacy)).toBe(3);

    const specs = generateVariationSpecs(specInput(legacy));
    expect(specs.map((s) => s.label)).toEqual([
      "18K Yellow · Natural · G-VS1",
      "18K Yellow · Lab Grown · G-VS1",
      "18K Yellow · Moissanite",
    ]);
  });

  it("prices one row per combo when a stone has no grades selected", () => {
    const noGrades: VariationMatrixInput = {
      metals: ["gold"],
      purities: ["18K", "22K"],
      colors: ["yellow"],
      diamondTypes: ["lab-grown"],
      stoneGrades: { "lab-grown": { colors: [], clarities: [] } },
    };
    expect(countVariations(noGrades)).toBe(2);
    expect(generateVariationSpecs(specInput(noGrades))).toHaveLength(2);
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

  it("keeps a moissanite row on the moissanite rate and discount", () => {
    const rows = calculateAllVariations({
      netWeight: 1,
      diamondWeight: 1,
      gold24kRate: 10000,
      silverRate: 90,
      purityPercentages: { "18K": 75 },
      metals: ["gold"],
      purities: ["18K"],
      colors: ["yellow"],
      diamondTypes: ["natural", "moissanite"],
      stoneGrades: {
        natural: { colors: ["G"], clarities: ["VS1"] },
        moissanite: { colors: ["Colorless"], clarities: ["VS"] },
      },
      diamondRateNatural: 100_000,
      diamondRateLabGrown: 45_000,
      diamondRateMoissanite: 8_000,
      diamondDiscountPercentNatural: 20,
      diamondDiscountPercentLabGrown: 0,
      diamondDiscountPercentMoissanite: 5,
      makingCharge: 0,
      makingCalcType: "fixed",
      otherCharges: [],
    });

    expect(rows).toHaveLength(2);
    const moissanite = rows.find((r) => r.diamondType === "moissanite");
    expect(moissanite?.diamondRate).toBe("8000.00");
    expect(moissanite?.diamondColorGrade).toBe("Colorless");
    expect(moissanite?.calculation.diamondDiscountAmount).toBe("400.00");
  });
});
