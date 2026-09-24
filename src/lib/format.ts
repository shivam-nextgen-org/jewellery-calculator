import { toMoneyNumber } from "@/lib/pricing-engine";

/**
 * Format numbers in Indian grouping without Intl currency style.
 * Avoids Node vs browser hydration mismatches on ₹ / INR.
 */
function formatGrouped(
  value: number,
  maximumFractionDigits: number,
  minimumFractionDigits: number,
): string {
  const fixed = value.toFixed(
    Math.max(minimumFractionDigits, Math.min(maximumFractionDigits, 6)),
  );
  const [intPart, fracPart] = fixed.split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = intPart.replace("-", "");

  // Indian grouping: last 3, then pairs
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${pairs},${last3}`;
  }

  if (maximumFractionDigits === 0 || !fracPart) {
    return `${sign}${grouped}`;
  }

  const trimmedFrac =
    minimumFractionDigits > 0
      ? fracPart.padEnd(minimumFractionDigits, "0").slice(0, maximumFractionDigits)
      : fracPart.replace(/0+$/, "");

  return trimmedFrac.length > 0
    ? `${sign}${grouped}.${trimmedFrac}`
    : `${sign}${grouped}`;
}

/** INR formatting — currency is always ₹ for this application. */
export function formatINR(
  value: number | string,
  options?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  const numeric =
    typeof value === "string" ? toMoneyNumber(value) : value;
  const maximumFractionDigits = options?.maximumFractionDigits ?? 2;
  const minimumFractionDigits =
    options?.minimumFractionDigits ??
    (maximumFractionDigits > 0 ? 2 : 0);

  return `₹${formatGrouped(numeric, maximumFractionDigits, minimumFractionDigits)}`;
}

export function formatWeight(
  value: number | string,
  unit: "g" | "CT" = "g",
): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  return `${formatGrouped(numeric, 3, 0)} ${unit}`;
}

export function formatPercent(value: number | string): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  return `${formatGrouped(numeric, 2, 0)}%`;
}
