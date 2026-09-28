import { d, toMoneyNumber } from "@/lib/pricing-engine/decimal";
import {
  CURRENCY_META,
  type SupportedCurrency,
} from "@/lib/fx/currencies";
import { formatINR } from "@/lib/format";

/**
 * Convert an INR amount using a stored daily rate (1 INR = rate target).
 * INR returns the original value unchanged.
 * Returns null when the target rate is missing (caller must not fake FX).
 */
export function convertFromInr(
  inrValue: number | string,
  currency: SupportedCurrency,
  rates: Partial<Record<string, number>> | null | undefined,
): number | null {
  const numeric =
    typeof inrValue === "string" ? toMoneyNumber(inrValue) : inrValue;

  if (currency === "INR") return numeric;

  const rate = rates?.[currency];
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  const digits = CURRENCY_META[currency].fractionDigits;
  return d(numeric)
    .mul(rate)
    .toDecimalPlaces(digits)
    .toNumber();
}

/**
 * Format an INR monetary value for display in the selected currency.
 * INR path delegates to existing formatINR (identical appearance).
 * If FX rate is missing, keeps INR formatting (never swaps symbol only).
 */
export function formatMoney(
  inrValue: number | string,
  currency: SupportedCurrency,
  rates: Partial<Record<string, number>> | null | undefined,
  options?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  if (currency === "INR") {
    return formatINR(inrValue, options);
  }

  const converted = convertFromInr(inrValue, currency, rates);
  if (converted == null) {
    return formatINR(inrValue, options);
  }

  const meta = CURRENCY_META[currency];
  const maximumFractionDigits =
    options?.maximumFractionDigits ?? meta.fractionDigits;
  const minimumFractionDigits =
    options?.minimumFractionDigits ??
    (maximumFractionDigits > 0 ? Math.min(2, maximumFractionDigits) : 0);

  const fixed = converted.toFixed(
    Math.max(minimumFractionDigits, Math.min(maximumFractionDigits, 6)),
  );
  const [intPart, fracPart] = fixed.split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = intPart.replace("-", "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (maximumFractionDigits === 0 || !fracPart) {
    return `${meta.symbol}${sign}${grouped}`;
  }

  const trimmedFrac =
    minimumFractionDigits > 0
      ? fracPart.padEnd(minimumFractionDigits, "0").slice(0, maximumFractionDigits)
      : fracPart.replace(/0+$/, "");

  return trimmedFrac.length > 0
    ? `${meta.symbol}${sign}${grouped}.${trimmedFrac}`
    : `${meta.symbol}${sign}${grouped}`;
}
