import { describe, expect, it } from "vitest";
import {
  normalizeJewelleryRow,
  parseNumericCell,
  parseOptionalMoney,
  isEmptyJewelleryRow,
  BLANK_JEWELLERY_ROW,
} from "@/lib/excel/normalize-row";

describe("parseNumericCell", () => {
  it("parses plain numbers and comma-formatted strings", () => {
    expect(parseNumericCell(1.44)).toBe(1.44);
    expect(parseNumericCell("1,000.5")).toBe(1000.5);
    expect(parseNumericCell("")).toBe(0);
    expect(parseNumericCell(null)).toBe(0);
  });

  it("returns NaN for non-numeric text", () => {
    expect(Number.isNaN(parseNumericCell("abc"))).toBe(true);
  });
});

describe("parseOptionalMoney", () => {
  it("treats blank as null", () => {
    expect(parseOptionalMoney("")).toEqual({ ok: true, value: null });
    expect(parseOptionalMoney(null)).toEqual({ ok: true, value: null });
  });

  it("parses amounts", () => {
    expect(parseOptionalMoney(500)).toEqual({ ok: true, value: 500 });
  });

  it("rejects garbage", () => {
    expect(parseOptionalMoney("n/a")).toEqual({ ok: false });
  });
});

describe("normalizeJewelleryRow", () => {
  it("maps string and number fields", () => {
    const { data, invalidNumberKeys } = normalizeJewelleryRow({
      designNo: " LR-1 ",
      category: "Ring",
      goldCode: "G10Y",
      grossWeight: "2.22",
      netWeight: 1.9,
      diamondPieces: "28",
      certificatePrice: "",
    });
    expect(invalidNumberKeys).toEqual([]);
    expect(data.designNo).toBe("LR-1");
    expect(data.grossWeight).toBe(2.22);
    expect(data.netWeight).toBe(1.9);
    expect(data.diamondPieces).toBe(28);
    expect(data.certificatePrice).toBeNull();
  });

  it("flags invalid number cells", () => {
    const { data, invalidNumberKeys } = normalizeJewelleryRow({
      designNo: "X",
      netWeight: "oops",
    });
    expect(invalidNumberKeys).toContain("netWeight");
    expect(data.netWeight).toBe(0);
  });
});

describe("isEmptyJewelleryRow", () => {
  it("detects blank rows", () => {
    expect(isEmptyJewelleryRow(BLANK_JEWELLERY_ROW)).toBe(true);
    expect(
      isEmptyJewelleryRow({ ...BLANK_JEWELLERY_ROW, designNo: "A" }),
    ).toBe(false);
  });
});
