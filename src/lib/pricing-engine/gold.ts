import type { GoldPurityOption } from "@/types/jewellery";
import { d, money, rate, toMoneyString, type DecimalInput } from "./decimal";

export function calculatePurityRatePerGram(
  gold24kRate: DecimalInput,
  purityPercent: DecimalInput,
) {
  return money(d(gold24kRate).mul(d(purityPercent)).div(100));
}

export function buildPurityRateTable(
  gold24kRate: DecimalInput,
  percentages: Partial<Record<GoldPurityOption, DecimalInput>>,
): {
  purity: GoldPurityOption;
  percentage: string;
  ratePerGram: string;
}[] {
  return (Object.keys(percentages) as GoldPurityOption[]).map((purity) => {
    const percentage = rate(percentages[purity] ?? 0);
    return {
      purity,
      percentage: percentage.toString(),
      ratePerGram: toMoneyString(
        calculatePurityRatePerGram(gold24kRate, percentage),
      ),
    };
  });
}

export function calculateGoldPrice(
  netWeight: DecimalInput,
  goldRatePerGram: DecimalInput,
) {
  return money(d(netWeight).mul(d(goldRatePerGram)));
}

export function goldPriceFormula(
  netWeight: DecimalInput,
  goldRatePerGram: DecimalInput,
): string {
  return `${d(netWeight).toString()}g × ₹${d(goldRatePerGram).toFixed(2)}`;
}
