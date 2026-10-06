import { describe, expect, it } from "vitest";
import {
  defaultStoneGradeSelection,
  gradeOptionsForStoneType,
  migrateVariationSelection,
  stoneGradesForType,
} from "./variation-selection";
import type { VariationSelection } from "@/types/jewellery";

describe("grade options per stone type", () => {
  it("offers GIA grades for diamonds and commercial bands for moissanite", () => {
    expect(gradeOptionsForStoneType("natural").colors).toContain("G");
    expect(gradeOptionsForStoneType("lab-grown").clarities).toContain("VVS1");
    expect(gradeOptionsForStoneType("moissanite").colors).toEqual([
      "Colorless",
      "Near Colorless",
      "Warm",
    ]);
    expect(gradeOptionsForStoneType("moissanite").clarities).toEqual([
      "FL/IF",
      "VVS",
      "VS",
      "SI",
    ]);
    expect(gradeOptionsForStoneType("moissanite").colors).not.toContain("G");
  });

  it("prefers the grades configured in Settings for that stone", () => {
    const options = gradeOptionsForStoneType("natural", {
      colorRules: [{ grade: "D", adjustmentPercent: 0 }],
      clarityRules: [{ grade: "VS1", adjustmentPercent: 0 }],
    });
    expect(options).toEqual({ colors: ["D"], clarities: ["VS1"] });
  });

  it("starts a stone at its own base grade", () => {
    expect(defaultStoneGradeSelection("natural")).toEqual({
      colors: ["G"],
      clarities: ["VS1"],
    });
    expect(defaultStoneGradeSelection("moissanite")).toEqual({
      colors: ["Colorless"],
      clarities: ["VS"],
    });
  });

  it("drops grades that left the stone's scale and reseeds the base", () => {
    expect(
      stoneGradesForType(
        { moissanite: { colors: ["G"], clarities: ["VS"] } },
        "moissanite",
      ),
    ).toEqual({ colors: ["Colorless"], clarities: ["VS"] });
  });
});

describe("migrating saved selections", () => {
  it("splits a legacy global grade axis across stone types", () => {
    const legacy = {
      metals: ["gold"],
      purities: ["18K"],
      colors: ["yellow"],
      diamondTypes: ["natural", "moissanite"],
      diamondColors: ["G", "D"],
      diamondClarities: ["VS1"],
    } as unknown as VariationSelection;

    const migrated = migrateVariationSelection(legacy);

    expect(migrated.stoneGrades.natural).toEqual({
      colors: ["G", "D"],
      clarities: ["VS1"],
    });
    expect(migrated.stoneGrades["lab-grown"]).toEqual({
      colors: ["G", "D"],
      clarities: ["VS1"],
    });
    // GIA grades can't price moissanite — it falls back to its own base band.
    expect(migrated.stoneGrades.moissanite).toEqual({
      colors: ["Colorless"],
      clarities: ["VS"],
    });
    expect(migrated.metals).toEqual(["gold"]);
    expect(migrated.diamondTypes).toEqual(["natural", "moissanite"]);
  });

  it("leaves an already-migrated selection alone", () => {
    const current: VariationSelection = {
      metals: ["silver"],
      purities: ["925"],
      colors: ["sterling"],
      diamondTypes: ["moissanite"],
      stoneGrades: {
        natural: { colors: ["D"], clarities: ["IF"] },
        "lab-grown": { colors: [], clarities: [] },
        moissanite: { colors: ["Warm"], clarities: ["SI"] },
      },
    };
    const migrated = migrateVariationSelection(current);
    expect(migrated.stoneGrades.natural).toEqual({
      colors: ["D"],
      clarities: ["IF"],
    });
    expect(migrated.stoneGrades.moissanite).toEqual({
      colors: ["Warm"],
      clarities: ["SI"],
    });
    expect(migrated.purities).toEqual(["925"]);
  });

  it("seeds a usable default selection when nothing is saved", () => {
    const migrated = migrateVariationSelection(null);
    expect(migrated.metals).toEqual(["gold"]);
    expect(migrated.diamondTypes).toEqual(["natural", "lab-grown"]);
    expect(migrated.stoneGrades.natural).toEqual({
      colors: ["G"],
      clarities: ["VS1"],
    });
  });
});
