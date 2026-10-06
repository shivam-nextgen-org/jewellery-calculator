import { describe, expect, it } from "vitest";
import {
  PricingProfileValidationError,
  validatePricingProfileInput,
} from "./profile-validate";
import type { PricingProfileInput } from "@/types/jewellery";

function validInput(
  overrides: Partial<PricingProfileInput> = {},
): PricingProfileInput {
  return {
    name: "Natural Diamond — Default",
    stoneType: "natural",
    basePricePerCt: 100000,
    baseColorGrade: "G",
    baseClarityGrade: "VS1",
    calculationMethod: "additive",
    colorRules: [
      { grade: "D", adjustmentPercent: 20 },
      { grade: "G", adjustmentPercent: 0 },
    ],
    clarityRules: [
      { grade: "VVS1", adjustmentPercent: 25 },
      { grade: "VS1", adjustmentPercent: 0 },
    ],
    ...overrides,
  };
}

describe("validatePricingProfileInput", () => {
  it("accepts a valid profile", () => {
    const result = validatePricingProfileInput(validInput());
    expect(result.basePricePerCt).toBe(100000);
    expect(result.calculationMethod).toBe("additive");
  });

  it("rejects non-zero base clarity", () => {
    expect(() =>
      validatePricingProfileInput(
        validInput({
          clarityRules: [
            { grade: "VS1", adjustmentPercent: 5 },
            { grade: "VS2", adjustmentPercent: 0 },
          ],
        }),
      ),
    ).toThrow(PricingProfileValidationError);
  });

  it("rejects duplicate grades", () => {
    expect(() =>
      validatePricingProfileInput(
        validInput({
          colorRules: [
            { grade: "G", adjustmentPercent: 0 },
            { grade: "G", adjustmentPercent: 0 },
          ],
        }),
      ),
    ).toThrow(/Duplicate/);
  });

  it("rejects negative base price", () => {
    expect(() =>
      validatePricingProfileInput(validInput({ basePricePerCt: -1 })),
    ).toThrow(/base price/i);
  });

  it("rejects missing base color in rules", () => {
    expect(() =>
      validatePricingProfileInput(
        validInput({
          baseColorGrade: "H",
          colorRules: [{ grade: "G", adjustmentPercent: 0 }],
        }),
      ),
    ).toThrow(/base color/i);
  });
});
