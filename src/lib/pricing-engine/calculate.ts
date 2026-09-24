import {
  calculateMakingCharge,
  calculateOtherCharges,
  chargeFormula,
} from "./charges";
import { d, money, toMoneyString } from "./decimal";
import {
  calculateDiamondFinal,
  diamondGrossFormula,
} from "./diamond";
import { calculateGoldPrice, goldPriceFormula } from "./gold";
import type {
  AppliedOverrides,
  CalculateJewelleryPriceInput,
  CalculateJewelleryPriceResult,
} from "./types";

const NO_OVERRIDES: AppliedOverrides = {
  makingCharge: false,
  diamondDiscountPercent: false,
  otherChargesTotal: false,
  finalPrice: false,
};

/**
 * Central jewellery pricing engine.
 * All money math uses Decimal — never call this from duplicated UI formulas.
 */
export function calculateJewelleryPrice(
  input: CalculateJewelleryPriceInput,
): CalculateJewelleryPriceResult {
  const netWeight = d(input.netWeight);
  const goldRate = d(input.goldRatePerGram);

  const goldPrice = calculateGoldPrice(netWeight, goldRate);

  const discountPercent =
    input.overrides?.diamondDiscountPercent != null &&
    input.overrides.diamondDiscountPercent !== ""
      ? d(input.overrides.diamondDiscountPercent)
      : d(input.diamondDiscountPercent);

  const { gross, discountAmount, finalPrice: diamondFinal } =
    calculateDiamondFinal(
      input.diamondWeight,
      input.diamondRate,
      discountPercent,
    );

  let making = calculateMakingCharge(
    input.makingCharge,
    input.makingCalcType,
    netWeight,
    goldPrice,
  );
  const makingOverridden =
    input.overrides?.makingCharge != null &&
    input.overrides.makingCharge !== "";
  if (makingOverridden) {
    making = money(input.overrides!.makingCharge!);
  }

  const { lines: otherLines, total: otherComputed } = calculateOtherCharges(
    input.otherCharges,
    netWeight,
    goldPrice,
  );

  let otherTotal = otherComputed;
  const otherOverridden =
    input.overrides?.otherChargesTotal != null &&
    input.overrides.otherChargesTotal !== "";
  if (otherOverridden) {
    otherTotal = money(input.overrides!.otherChargesTotal!);
  }

  const subtotal = money(goldPrice.add(diamondFinal).add(making).add(otherTotal));

  let finalPrice = subtotal;
  const finalOverridden =
    input.overrides?.finalPrice != null && input.overrides.finalPrice !== "";
  if (finalOverridden) {
    finalPrice = money(input.overrides!.finalPrice!);
  }

  const appliedOverrides: AppliedOverrides = {
    makingCharge: makingOverridden,
    diamondDiscountPercent:
      input.overrides?.diamondDiscountPercent != null &&
      input.overrides.diamondDiscountPercent !== "",
    otherChargesTotal: otherOverridden,
    finalPrice: finalOverridden,
  };

  return {
    goldPrice: toMoneyString(goldPrice),
    diamondGrossPrice: toMoneyString(gross),
    diamondDiscountAmount: toMoneyString(discountAmount),
    diamondFinalPrice: toMoneyString(diamondFinal),
    makingCharge: toMoneyString(making),
    otherCharges: otherLines,
    otherChargesTotal: toMoneyString(otherTotal),
    subtotal: toMoneyString(subtotal),
    finalPrice: toMoneyString(finalPrice),
    appliedOverrides: appliedOverrides.makingCharge ||
      appliedOverrides.diamondDiscountPercent ||
      appliedOverrides.otherChargesTotal ||
      appliedOverrides.finalPrice
      ? appliedOverrides
      : NO_OVERRIDES,
    breakdown: {
      netWeight: netWeight.toString(),
      goldRatePerGram: goldRate.toFixed(2),
      goldFormula: goldPriceFormula(netWeight, goldRate),
      diamondWeight: d(input.diamondWeight).toString(),
      diamondRate: d(input.diamondRate).toFixed(2),
      diamondGrossFormula: diamondGrossFormula(
        input.diamondWeight,
        input.diamondRate,
      ),
      diamondDiscountPercent: discountPercent.toString(),
      diamondDiscountFormula: `${discountPercent.toString()}% of diamond gross`,
      makingFormula: makingOverridden
        ? `Manual override ₹${toMoneyString(making)}`
        : chargeFormula(
            "Making",
            input.makingCharge,
            input.makingCalcType,
            netWeight,
            "Gold Price",
          ),
      otherLines: otherLines.map((line) => {
        const source = input.otherCharges.find((c) => c.id === line.id);
        return {
          name: line.name,
          amount: line.calculatedAmount,
          formula: source
            ? chargeFormula(
                line.name,
                source.amount,
                source.calcType,
                netWeight,
                "Gold Price",
              )
            : line.name,
        };
      }),
    },
  };
}

export function hasAnyOverride(
  result: CalculateJewelleryPriceResult,
): boolean {
  const o = result.appliedOverrides;
  return (
    o.makingCharge ||
    o.diamondDiscountPercent ||
    o.otherChargesTotal ||
    o.finalPrice
  );
}
