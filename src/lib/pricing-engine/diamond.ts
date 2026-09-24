import { d, money, type DecimalInput } from "./decimal";

export function calculateDiamondGross(
  diamondWeight: DecimalInput,
  diamondRate: DecimalInput,
) {
  return money(d(diamondWeight).mul(d(diamondRate)));
}

export function calculateDiamondDiscountAmount(
  gross: DecimalInput,
  discountPercent: DecimalInput,
) {
  return money(d(gross).mul(d(discountPercent)).div(100));
}

export function calculateDiamondFinal(
  diamondWeight: DecimalInput,
  diamondRate: DecimalInput,
  discountPercent: DecimalInput,
) {
  const gross = calculateDiamondGross(diamondWeight, diamondRate);
  const discountAmount = calculateDiamondDiscountAmount(gross, discountPercent);
  const finalPrice = money(gross.sub(discountAmount));
  return { gross, discountAmount, finalPrice };
}

export function diamondGrossFormula(
  diamondWeight: DecimalInput,
  diamondRate: DecimalInput,
): string {
  return `${d(diamondWeight).toString()} CT × ₹${d(diamondRate).toFixed(2)}`;
}
