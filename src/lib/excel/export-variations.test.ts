import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildVariationExportRows,
  buildVariationWorkbookBuffer,
  safeExportFileName,
  variationMatchesSearch,
} from "@/lib/excel/export-variations";
import type { PricedVariation } from "@/lib/pricing-engine";

function stubVariation(
  partial: Partial<PricedVariation> & Pick<PricedVariation, "id" | "label">,
): PricedVariation {
  return {
    metal: "gold",
    metalLabel: "Gold",
    purity: "18K",
    color: "yellow",
    colorLabel: "Yellow Gold",
    diamondType: "natural",
    diamondTypeLabel: "Natural",
    diamondColorGrade: null,
    diamondClarityGrade: null,
    goldRatePerGram: "11098.5",
    goldPurityPercent: "75",
    diamondRate: "10000",
    hasManualOverride: false,
    calculation: {
      goldPrice: "46613.70",
      diamondGrossPrice: "5000.00",
      diamondDiscountAmount: "0.00",
      diamondFinalPrice: "5000.00",
      makingCharge: "4830.00",
      otherCharges: [],
      otherChargesTotal: "3000.00",
      subtotal: "59443.70",
      finalPrice: "59443.70",
      appliedOverrides: {
        makingCharge: false,
        diamondDiscountPercent: false,
        otherChargesTotal: false,
        finalPrice: false,
      },
      breakdown: {
        netWeight: "4.2",
        goldRatePerGram: "11098.5",
        goldFormula: "",
        diamondWeight: "0.5",
        diamondRate: "10000",
        diamondGrossFormula: "",
        diamondDiscountPercent: "0",
        diamondDiscountFormula: "",
        makingFormula: "",
        otherLines: [],
      },
    },
    ...partial,
  };
}

describe("buildVariationExportRows", () => {
  it("maps table columns with numeric amounts", () => {
    const rows = buildVariationExportRows(
      [stubVariation({ id: "1", label: "18K Yellow · Natural · G-VS1" })],
      {
        designNo: "PN-0088",
        category: "Pendant",
        netWeight: 4.2,
        diamondWeight: 0.5,
        currency: "INR",
        rates: { INR: 1 },
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Variation: "18K Yellow · Natural · G-VS1",
      "Metal / Purity": "Gold · 18K",
      Color: "Yellow",
      Diamond: "Natural",
      "Dia Colour": "—",
      Clarity: "—",
      "Net Wt": 4.2,
      "Dia Wt": 0.5,
      Final: 59443.7,
    });
  });
});

describe("buildVariationWorkbookBuffer", () => {
  it("produces a readable xlsx with Variation prices sheet", () => {
    const buffer = buildVariationWorkbookBuffer(
      [stubVariation({ id: "1", label: "18K Yellow · Natural · G-VS1" })],
      {
        designNo: "PN-0088",
        category: "Pendant",
        netWeight: 4.2,
        diamondWeight: 0.5,
        currency: "INR",
        rates: { INR: 1 },
        exportedAt: "2026-09-29T07:00:00.000Z",
      },
    );
    const wb = XLSX.read(buffer, { type: "array" });
    expect(wb.SheetNames).toEqual(["Variation prices"]);
    const prices = XLSX.utils.sheet_to_json(wb.Sheets["Variation prices"]!);
    expect(prices).toHaveLength(1);
  });
});

describe("safeExportFileName", () => {
  it("sanitizes design numbers", () => {
    expect(safeExportFileName("PN/0088")).toBe("PN-0088-variation-prices.xlsx");
  });
});

describe("variationMatchesSearch", () => {
  const row = stubVariation({ id: "1", label: "18K Yellow · Natural" });

  it("matches purity / color / diamond", () => {
    expect(variationMatchesSearch(row, "18k")).toBe(true);
    expect(variationMatchesSearch(row, "yellow")).toBe(true);
    expect(variationMatchesSearch(row, "natural")).toBe(true);
    expect(variationMatchesSearch(row, "moissanite")).toBe(false);
  });

  it("empty query matches all", () => {
    expect(variationMatchesSearch(row, "  ")).toBe(true);
  });
});
