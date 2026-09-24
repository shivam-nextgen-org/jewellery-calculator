import type { ChargeCalcType } from "@/types/jewellery";
import { d, money, toMoneyString, type DecimalInput } from "./decimal";
import type { ChargeInput, ChargeLineResult } from "./types";

export function calculateChargeAmount(
  amount: DecimalInput,
  calcType: ChargeCalcType,
  netWeight: DecimalInput,
  baseForPercent: DecimalInput,
): ReturnType<typeof money> {
  const amt = d(amount);
  if (calcType === "per-gram") {
    return money(amt.mul(d(netWeight)));
  }
  if (calcType === "percentage") {
    return money(d(baseForPercent).mul(amt).div(100));
  }
  return money(amt);
}

export function chargeFormula(
  name: string,
  amount: DecimalInput,
  calcType: ChargeCalcType,
  netWeight: DecimalInput,
  baseLabel: string,
): string {
  const amt = d(amount);
  if (calcType === "per-gram") {
    return `${d(netWeight).toString()}g × ₹${amt.toString()} = ${name}`;
  }
  if (calcType === "percentage") {
    return `${amt.toString()}% of ${baseLabel}`;
  }
  return `Fixed ₹${amt.toString()}`;
}

export function calculateMakingCharge(
  makingCharge: DecimalInput,
  makingCalcType: ChargeCalcType,
  netWeight: DecimalInput,
  goldPrice: DecimalInput,
) {
  return calculateChargeAmount(
    makingCharge,
    makingCalcType,
    netWeight,
    goldPrice,
  );
}

export function calculateOtherCharges(
  charges: ChargeInput[],
  netWeight: DecimalInput,
  goldPrice: DecimalInput,
): { lines: ChargeLineResult[]; total: ReturnType<typeof money> } {
  const lines: ChargeLineResult[] = charges.map((charge) => {
    const calculated = calculateChargeAmount(
      charge.amount,
      charge.calcType,
      netWeight,
      goldPrice,
    );
    return {
      id: charge.id,
      name: charge.name,
      calcType: charge.calcType,
      inputAmount: d(charge.amount).toString(),
      calculatedAmount: toMoneyString(calculated),
    };
  });

  const total = lines.reduce(
    (sum, line) => money(sum.add(d(line.calculatedAmount))),
    money(0),
  );

  return { lines, total };
}
