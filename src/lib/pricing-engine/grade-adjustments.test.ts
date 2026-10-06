import { describe, expect, it } from "vitest";
import {
  calculateAdditiveRatePerCt,
  calculateAdjustedRatePerCt,
  calculateRateFromGradeProfile,
  calculateSequentialRatePerCt,
  formatAdjustmentPercent,
  lookupAdjustmentPercent,
  parsePercentageInput,
  resolveAdjustmentMap,
} from "./grade-adjustments";

describe("calculateAdditiveRatePerCt", () => {
  it("applies positive color + clarity as a single sum", () => {
    const result = calculateAdditiveRatePerCt(1_000_000, [20, 25]);
    expect(result.ratePerCt.toFixed(2)).toBe("1450000.00");
    expect(result.totalAdjustmentPercent.toFixed(4)).toBe("45.0000");
  });

  it("applies negative adjustments", () => {
    const result = calculateAdditiveRatePerCt(1_000_000, [-10, -20]);
    expect(result.ratePerCt.toFixed(2)).toBe("700000.00");
  });

  it("applies mixed adjustments", () => {
    const result = calculateAdditiveRatePerCt(1_000_000, [20, -10]);
    expect(result.ratePerCt.toFixed(2)).toBe("1100000.00");
  });

  it("returns base when adjustments are zero", () => {
    const result = calculateAdditiveRatePerCt(1_000_000, [0, 0]);
    expect(result.ratePerCt.toFixed(2)).toBe("1000000.00");
  });

  it("supports decimal percentages", () => {
    const result = calculateAdditiveRatePerCt(1_000_000, [12.5, -7.5]);
    expect(result.ratePerCt.toFixed(2)).toBe("1050000.00");
  });

  it("handles large jewellery base prices", () => {
    const result = calculateAdditiveRatePerCt(2_500_000, [15, 10]);
    expect(result.ratePerCt.toFixed(2)).toBe("3125000.00");
  });
});

describe("calculateSequentialRatePerCt", () => {
  it("multiplies factors in order", () => {
    const result = calculateSequentialRatePerCt(1_000_000, [20, 25]);
    expect(result.ratePerCt.toFixed(2)).toBe("1500000.00");
  });

  it("differs from additive for the same inputs", () => {
    const additive = calculateAdditiveRatePerCt(1_000_000, [20, 25]);
    const sequential = calculateSequentialRatePerCt(1_000_000, [20, 25]);
    expect(additive.ratePerCt.toFixed(2)).toBe("1450000.00");
    expect(sequential.ratePerCt.toFixed(2)).toBe("1500000.00");
  });

  it("handles negative sequential adjustments", () => {
    const result = calculateSequentialRatePerCt(1_000_000, [-10, -20]);
    // 1_000_000 × 0.9 × 0.8 = 720_000
    expect(result.ratePerCt.toFixed(2)).toBe("720000.00");
  });
});

describe("calculateAdjustedRatePerCt", () => {
  it("defaults unknown method to additive", () => {
    const result = calculateAdjustedRatePerCt({
      basePricePerCt: 1_000_000,
      adjustments: [20, 25],
      calculationMethod: "additive",
    });
    expect(result.ratePerCt).toBe("1450000.00");
    expect(result.method).toBe("additive");
  });

  it("uses sequential when selected", () => {
    const result = calculateAdjustedRatePerCt({
      basePricePerCt: 1_000_000,
      adjustments: [20, 25],
      calculationMethod: "sequential",
    });
    expect(result.ratePerCt).toBe("1500000.00");
    expect(result.method).toBe("sequential");
  });

  it("rounds money half-up to 2 dp", () => {
    // 100 × (1 + 1/300) ≈ 100.333… → 100.33
    const result = calculateAdjustedRatePerCt({
      basePricePerCt: 100,
      adjustments: [1 / 3],
      calculationMethod: "additive",
    });
    expect(result.ratePerCt).toBe("100.33");
  });
});

describe("rule lookup helpers", () => {
  const rules = [
    { grade: "D", adjustmentPercent: 20 },
    { grade: "G", adjustmentPercent: 0 },
    { grade: "VS1", adjustmentPercent: 0 },
    { grade: "VVS1", adjustmentPercent: 25 },
  ];

  it("resolveAdjustmentMap indexes by grade", () => {
    const map = resolveAdjustmentMap(rules);
    expect(map.get("D")).toBe(20);
    expect(map.get("G")).toBe(0);
  });

  it("lookupAdjustmentPercent returns 0 for missing grades", () => {
    expect(lookupAdjustmentPercent(rules, "Z")).toBe(0);
    expect(lookupAdjustmentPercent(rules, null)).toBe(0);
  });

  it("calculateRateFromGradeProfile combines color and clarity", () => {
    const result = calculateRateFromGradeProfile({
      basePricePerCt: 1_000_000,
      colorRules: [
        { grade: "D", adjustmentPercent: 20 },
        { grade: "G", adjustmentPercent: 0 },
      ],
      clarityRules: [
        { grade: "VVS1", adjustmentPercent: 25 },
        { grade: "VS1", adjustmentPercent: 0 },
      ],
      colorGrade: "D",
      clarityGrade: "VVS1",
      calculationMethod: "additive",
    });
    expect(result.ratePerCt).toBe("1450000.00");
    expect(result.colorAdjustmentPercent).toBe(20);
    expect(result.clarityAdjustmentPercent).toBe(25);
  });
});

describe("percentage parsing / formatting", () => {
  it("parses +20, 20, -10, and % suffix", () => {
    expect(parsePercentageInput("+20")).toBe(20);
    expect(parsePercentageInput("20")).toBe(20);
    expect(parsePercentageInput("-10")).toBe(-10);
    expect(parsePercentageInput("12.5%")).toBe(12.5);
  });

  it("formats signed display strings", () => {
    expect(formatAdjustmentPercent(20)).toBe("+20%");
    expect(formatAdjustmentPercent(-10)).toBe("-10%");
    expect(formatAdjustmentPercent(0)).toBe("0%");
  });
});
