import { describe, expect, it } from "vitest";
import {
  defaultBaseClarityForStoneType,
  defaultBaseColorForStoneType,
  defaultClarityRulesForStoneType,
  defaultColorRulesForStoneType,
  defaultProfileNameForStoneType,
} from "./grade-defaults";

describe("grade-defaults", () => {
  it("uses VS1 / G for natural and lab-grown diamonds", () => {
    expect(defaultBaseClarityForStoneType("natural")).toBe("VS1");
    expect(defaultBaseColorForStoneType("lab-grown")).toBe("G");
    expect(defaultClarityRulesForStoneType("natural").some((r) => r.grade === "VS1")).toBe(
      true,
    );
    expect(
      defaultClarityRulesForStoneType("natural").find((r) => r.grade === "VS1")
        ?.adjustmentPercent,
    ).toBe(0);
  });

  it("uses commercial grades for moissanite", () => {
    expect(defaultBaseClarityForStoneType("moissanite")).toBe("VS");
    expect(defaultBaseColorForStoneType("moissanite")).toBe("Colorless");
    expect(defaultClarityRulesForStoneType("moissanite").map((r) => r.grade)).toEqual([
      "FL/IF",
      "VVS",
      "VS",
      "SI",
    ]);
    expect(defaultProfileNameForStoneType("moissanite")).toContain("Moissanite");
  });

  it("seeds all adjustments at 0%", () => {
    for (const rule of defaultColorRulesForStoneType("natural")) {
      expect(rule.adjustmentPercent).toBe(0);
    }
  });
});
