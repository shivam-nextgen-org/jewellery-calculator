import * as XLSX from "xlsx";
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
  const rateKey = `Gold Rate (${c})`;
  const goldKey = `Gold (${c})`;
  const diaKey = `Diamond (${c})`;
  const makingKey = `Making (${c})`;
  const otherKey = `Other (${c})`;
  const finalKey = `Final (${c})`;

  return variations.map((row) => ({
    Variation: row.label,
    "Metal / Purity": `${row.metalLabel} · ${row.purity}`,
    Color: row.colorLabel.replace(/ Gold$/, ""),
    Diamond: row.diamondTypeLabel,
    "Net Wt (g)": meta.netWeight,
    [rateKey]: moneyInDisplayCurrency(row.goldRatePerGram, c, meta.rates),
    [goldKey]: moneyInDisplayCurrency(row.calculation.goldPrice, c, meta.rates),
    "Dia Wt (CT)": meta.diamondWeight,
    [diaKey]: moneyInDisplayCurrency(
      row.calculation.diamondFinalPrice,
      c,
      meta.rates,
    ),
    [makingKey]: moneyInDisplayCurrency(
      row.calculation.makingCharge,
      c,
      meta.rates,
    ),
    [otherKey]: moneyInDisplayCurrency(
      row.calculation.otherChargesTotal,
      c,
      meta.rates,
    ),
    [finalKey]: moneyInDisplayCurrency(
      row.calculation.finalPrice,
      c,
      meta.rates,
    ),
    Currency: c,
    "Manual Override": row.hasManualOverride ? "Yes" : "No",
  }));
}

export function buildVariationWorkbookBuffer(
  variations: PricedVariation[],
  meta: VariationExportMeta,
): ArrayBuffer {
  const rows = buildVariationExportRows(variations, meta);
  const exportedAt =
    meta.exportedAt ?? new Date().toISOString();

  const summaryAoa: (string | number)[][] = [
    ["Field", "Value"],
    ["Design No", meta.designNo],
    ["Category", meta.category],
    ["Net Weight (g)", meta.netWeight],
    ["Diamond Weight (CT)", meta.diamondWeight],
    ["Variations", variations.length],
    ["Currency", meta.currency],
    ["Exported At (UTC)", exportedAt],
  ];

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
  summarySheet["!cols"] = [{ wch: 22 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const pricesSheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["No variations"]]);
  if (rows.length > 0) {
    pricesSheet["!cols"] = Object.keys(rows[0]!).map((key) => ({
      wch: Math.min(28, Math.max(12, key.length + 2)),
    }));
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
