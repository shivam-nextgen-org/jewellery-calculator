import { describe, expect, it } from "vitest";
import { buildMetalCodeFromParts, parseGoldCode } from "./parser";

describe("gold-code parser — metal / colour separation", () => {
  it("maps gold codes to gold colours", () => {
    const g = parseGoldCode("G18Y");
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.metal).toBe("gold");
      expect(g.purity).toBe("18K");
      expect(g.color).toBe("yellow");
      expect(g.colorLabel).toBe("Yellow Gold");
    }
  });

  it("maps silver codes to the single sterling colour", () => {
    const s = parseGoldCode("S925");
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.metal).toBe("silver");
      expect(s.purity).toBe("925");
      expect(s.color).toBe("sterling");
      expect(s.colorLabel).toBe("Sterling Silver");
    }
  });

  it("never produces a gold colour on a silver code, even with a legacy suffix", () => {
    for (const code of ["S925Y", "S999W", "S958R"]) {
      const parsed = parseGoldCode(code);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.metal).toBe("silver");
        expect(parsed.color).toBe("sterling");
        // Normalised code drops the gold colour suffix.
        expect(parsed.normalizedCode).toMatch(/^S\d{3}$/);
      }
    }
  });

  it("ignores a colour column when building a silver code from parts", () => {
    const built = buildMetalCodeFromParts("Silver", "925", "Yellow Gold");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.metal).toBe("silver");
      expect(built.color).toBe("sterling");
    }
  });

  it("still requires a valid colour when building a gold code from parts", () => {
    const built = buildMetalCodeFromParts("Gold", "18", "Rose Gold");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.metal).toBe("gold");
      expect(built.purity).toBe("18K");
      expect(built.color).toBe("rose");
    }
  });
});
