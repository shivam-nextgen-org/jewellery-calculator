import Decimal from "decimal.js";

/** Financial Decimal config — money & weights never use binary floats. */
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export { Decimal };

export type DecimalInput = string | number | Decimal;

export function d(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (value === "" || value === null || value === undefined) {
    return new Decimal(0);
  }
  return new Decimal(value);
}

/** Money: 2 decimal places, half-up. */
export function money(value: DecimalInput): Decimal {
  return d(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Weight: up to 4 decimal places. */
export function weight(value: DecimalInput): Decimal {
  return d(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Rate / percentage: up to 4 decimal places. */
export function rate(value: DecimalInput): Decimal {
  return d(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function toMoneyNumber(value: DecimalInput): number {
  return money(value).toNumber();
}

export function toMoneyString(value: DecimalInput): string {
  return money(value).toFixed(2);
}
