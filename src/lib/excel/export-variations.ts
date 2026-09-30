import * as XLSX from "xlsx-js-style";
import { convertFromInr } from "@/lib/fx/format-money";
import type { SupportedCurrency } from "@/lib/fx/currencies";
import { toMoneyNumber } from "@/lib/pricing-engine/decimal";
import type { PricedVariation } from "@/lib/pricing-engine";

export type VariationExportMeta = {
  designNo: string;
  category: string;
  netWeight: number;
  diamondWeight: number;
  currency: SupportedCurrency;
  rates: Partial<Record<string, number>> | null;
  exportedAt?: string;
};

function moneyInDisplayCurrency(
  inrValue: number | string,
  currency: SupportedCurrency,
  rates: Partial<Record<string, number>> | null,
): number {
  const converted = convertFromInr(inrValue, currency, rates);
  if (converted != null) return converted;
  return typeof inrValue === "string" ? toMoneyNumber(inrValue) : inrValue;
}

/** Flat rows matching the Variation prices table (numeric amounts for Excel). */
export function buildVariationExportRows(
  variations: PricedVariation[],
  meta: VariationExportMeta,
): Record<string, string | number>[] {
  const c = meta.currency;

  // Columns mirror the on-screen "Variation prices" table exactly — same
  // headers, same order.
  return variations.map((row) => ({
    Variation: row.label,
    "Metal / Purity": `${row.metalLabel} · ${row.purity}`,
    Color: row.colorLabel.replace(/ Gold$/, ""),
    Diamond: row.diamondTypeLabel,
    "Net Wt": meta.netWeight,
    "Metal Rate": moneyInDisplayCurrency(row.goldRatePerGram, c, meta.rates),
    "Metal ₹": moneyInDisplayCurrency(row.calculation.goldPrice, c, meta.rates),
    "Dia Wt": meta.diamondWeight,
    "Diamond ₹": moneyInDisplayCurrency(
      row.calculation.diamondFinalPrice,
      c,
      meta.rates,
    ),
    Making: moneyInDisplayCurrency(row.calculation.makingCharge, c, meta.rates),
    Other: moneyInDisplayCurrency(
      row.calculation.otherChargesTotal,
      c,
      meta.rates,
    ),
    Final: moneyInDisplayCurrency(row.calculation.finalPrice, c, meta.rates),
  }));
}

export function buildVariationWorkbookBuffer(
  variations: PricedVariation[],
  meta: VariationExportMeta,
): ArrayBuffer {
  const rows = buildVariationExportRows(variations, meta);

  // Single sheet that mirrors the on-screen "Variation prices" table exactly —
  // same columns, same order, no extra summary sheet.
  const workbook = XLSX.utils.book_new();
  const pricesSheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["No variations"]]);
  if (rows.length > 0) {
    pricesSheet["!cols"] = Object.keys(rows[0]!).map((key) => ({
      wch: Math.min(28, Math.max(12, key.length + 2)),
    }));

    // Style the header row (row 0): light green background + bold black font.
    const headerStyle = {
      font: { bold: true, color: { rgb: "000000" } },
      fill: { patternType: "solid", fgColor: { rgb: "C6EFCE" } },
      alignment: { vertical: "center" },
    };
    const range = XLSX.utils.decode_range(pricesSheet["!ref"] as string);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = pricesSheet[addr];
      if (cell) cell.s = headerStyle;
    }
  }
  XLSX.utils.book_append_sheet(workbook, pricesSheet, "Variation prices");

  const out = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as number[];
  return new Uint8Array(out).buffer;
}

export function safeExportFileName(designNo: string): string {
  const base = designNo.trim().replace(/[^\w.-]+/g, "-") || "variations";
  return `${base}-variation-prices.xlsx`;
}

/** Browser download of the variation prices workbook. */
export function downloadVariationPricesExcel(
  variations: PricedVariation[],
  meta: VariationExportMeta,
  fileName?: string,
): void {
  if (typeof window === "undefined") return;
  const buffer = buildVariationWorkbookBuffer(variations, meta);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName ?? safeExportFileName(meta.designNo);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Case-insensitive match across variation display fields. */
export function variationMatchesSearch(
  row: PricedVariation,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.label,
    row.metalLabel,
    row.purity,
    row.colorLabel,
    row.diamondTypeLabel,
    row.metal,
    row.color,
    row.diamondType,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
