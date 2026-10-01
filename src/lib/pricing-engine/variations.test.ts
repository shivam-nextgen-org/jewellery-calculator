import { describe, expect, it } from "vitest";
import { countVariations, generateVariationSpecs, isValidCombination } from "./variations";
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
});
