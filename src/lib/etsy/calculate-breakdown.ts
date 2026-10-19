import type { EtsyCommissionSettings } from "@/types/etsy";

export type EtsyApplicableFlags = {
  currencyConversion: boolean;
  offsiteAds: boolean;
  listingRenewal: boolean;
  additionalQuantityListing: boolean;
  shopSetup: boolean;
};

export const DEFAULT_ETSY_APPLICABLE: EtsyApplicableFlags = {
  currencyConversion: true,
  offsiteAds: false,
  listingRenewal: false,
  additionalQuantityListing: false,
  shopSetup: false,
};

export type EtsyBreakdownLine = {
  id: string;
  label: string;
  amount: number;
  /** When true, line is TCS/TDS (not in Total Expenses). */
  isTaxCredit?: boolean;
};

export type EtsyBreakdownResult = {
  productCost: number;
  salePrice: number;
  lines: EtsyBreakdownLine[];
  totalExpenses: number;
  tcsAmount: number;
  tdsAmount: number;
  netProfit: number;
  profitMarginPercent: number;
};

function money(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Estimate Etsy P&L for a sale at `salePrice`, with jewellery `productCost`.
 * Percent fees are on sale price. GST applies only to eligible platform fees.
 */
export function calculateEtsyBreakdown(input: {
  productCost: number;
  salePrice: number;
  settings: EtsyCommissionSettings;
  applicable?: Partial<EtsyApplicableFlags>;
}): EtsyBreakdownResult {
  const s = input.settings;
  const P = Math.max(0, input.salePrice);
  const C = Math.max(0, input.productCost);
  const a = { ...DEFAULT_ETSY_APPLICABLE, ...input.applicable };

  const transactionFee = money((P * s.transactionFeePercent) / 100);
  const paymentProcessing = money(
    (P * s.paymentProcessingFeePercent) / 100 + s.paymentProcessingFixedFeeInr,
  );
  const regulatory = money((P * s.regulatoryOperatingFeePercent) / 100);
  const listingFee = money(s.listingFeeUsd * s.usdToInrRate);
  const eligibleForGst =
    transactionFee + paymentProcessing + regulatory + listingFee;
  const gstOnFees = money((eligibleForGst * s.gstOnEtsyFeesPercent) / 100);

  const currencyConversion = a.currencyConversion
    ? money((P * s.currencyConversionFeePercent) / 100)
    : 0;
  const offsiteAds = a.offsiteAds
    ? money((P * s.offsiteAdsFeePercent) / 100)
    : 0;
  const listingRenewal = a.listingRenewal
    ? money(s.listingRenewalFeeUsd * s.usdToInrRate)
    : 0;
  const additionalQty = a.additionalQuantityListing
    ? money(s.additionalQuantityListingFeeUsd * s.usdToInrRate)
    : 0;
  const shopSetup = a.shopSetup ? money(s.oneTimeShopSetupFeeInr) : 0;

  const shipping = money(s.shippingCostInr);
  const insurance = money(s.shippingInsuranceInr);
  const packaging = money(s.packagingCostInr);
  const returnReserve = money(s.returnReserveInr);
  const payoneer = money(s.payoneerWithdrawalFeeInr);
  const etsyAds = money(s.etsyAdsCostInr);

  const expenseLines: EtsyBreakdownLine[] = [
    { id: "transaction", label: "Etsy transaction fee", amount: transactionFee },
    {
      id: "payment",
      label: "Payment processing fee",
      amount: paymentProcessing,
    },
    {
      id: "regulatory",
      label: "Regulatory operating fee",
      amount: regulatory,
    },
    { id: "listing", label: "Listing fee", amount: listingFee },
    { id: "gst", label: "GST on Etsy fees", amount: gstOnFees },
    {
      id: "fx",
      label: "Currency conversion fee",
      amount: currencyConversion,
    },
    { id: "shipping", label: "Shipping cost", amount: shipping },
    { id: "insurance", label: "Shipping insurance", amount: insurance },
    { id: "packaging", label: "Packaging cost", amount: packaging },
    { id: "ads", label: "Advertising cost (Etsy ads)", amount: etsyAds },
    { id: "offsite", label: "Offsite ads fee", amount: offsiteAds },
    { id: "renewal", label: "Listing renewal fee", amount: listingRenewal },
    {
      id: "qtyListing",
      label: "Additional quantity listing",
      amount: additionalQty,
    },
    { id: "shopSetup", label: "One-time shop setup fee", amount: shopSetup },
    {
      id: "return",
      label: "Return / replacement reserve",
      amount: returnReserve,
    },
    { id: "payoneer", label: "Payoneer withdrawal fee", amount: payoneer },
  ];

  const totalExpenses = money(
    expenseLines.reduce((sum, line) => sum + line.amount, 0),
  );
  const tcsAmount = money((P * s.tcsDeductionPercent) / 100);
  const tdsAmount = money((P * s.tdsDeductionPercent) / 100);

  const taxLines: EtsyBreakdownLine[] = [
    { id: "tcs", label: "TCS deduction", amount: tcsAmount, isTaxCredit: true },
    { id: "tds", label: "TDS deduction", amount: tdsAmount, isTaxCredit: true },
  ];

  const netProfit = money(P - C - totalExpenses - tcsAmount - tdsAmount);
  const profitMarginPercent =
    P > 0 ? money((netProfit / P) * 100) : 0;

  return {
    productCost: money(C),
    salePrice: money(P),
    lines: [...expenseLines, ...taxLines],
    totalExpenses,
    tcsAmount,
    tdsAmount,
    netProfit,
    profitMarginPercent,
  };
}

export type EtsyInclusiveSalePrice = {
  jewelleryCost: number;
  /** Listing / sale price that covers jewellery + Etsy fees + TCS/TDS. */
  salePrice: number;
  /** salePrice − jewelleryCost */
  etsyAmount: number;
  /** Share of sale price taken by %-based fees (0–1). */
  variableRate: number;
  fixedFees: number;
};

/**
 * Solve for sale price P such that after Etsy expenses + TCS/TDS,
 * net ≈ jewellery cost (break-even on marketplace fees).
 *
 * P = (C + fixedFees) / (1 − variableRate)
 */
export function calculateEtsyInclusiveSalePrice(input: {
  productCost: number;
  settings: EtsyCommissionSettings;
  applicable?: Partial<EtsyApplicableFlags>;
}): EtsyInclusiveSalePrice {
  const s = input.settings;
  const C = Math.max(0, input.productCost);
  const a = { ...DEFAULT_ETSY_APPLICABLE, ...input.applicable };

  const listingFee = money(s.listingFeeUsd * s.usdToInrRate);
  const fixedPp = money(s.paymentProcessingFixedFeeInr);

  const t = s.transactionFeePercent / 100;
  const pp = s.paymentProcessingFeePercent / 100;
  const r = s.regulatoryOperatingFeePercent / 100;
  const g = s.gstOnEtsyFeesPercent / 100;
  const fx = a.currencyConversion ? s.currencyConversionFeePercent / 100 : 0;
  const oa = a.offsiteAds ? s.offsiteAdsFeePercent / 100 : 0;
  const tcs = s.tcsDeductionPercent / 100;
  const tds = s.tdsDeductionPercent / 100;

  // GST on (transaction + payment% + regulatory) × P, plus GST on fixed PP + listing
  const variableRate = t + pp + r + fx + oa + tcs + tds + g * (t + pp + r);

  let fixedFees =
    fixedPp +
    listingFee +
    g * (fixedPp + listingFee) +
    money(s.shippingCostInr) +
    money(s.shippingInsuranceInr) +
    money(s.packagingCostInr) +
    money(s.returnReserveInr) +
    money(s.payoneerWithdrawalFeeInr) +
    money(s.etsyAdsCostInr);

  if (a.listingRenewal) {
    fixedFees += money(s.listingRenewalFeeUsd * s.usdToInrRate);
  }
  if (a.additionalQuantityListing) {
    fixedFees += money(s.additionalQuantityListingFeeUsd * s.usdToInrRate);
  }
  if (a.shopSetup) {
    fixedFees += money(s.oneTimeShopSetupFeeInr);
  }
  fixedFees = money(fixedFees);

  if (variableRate >= 0.99) {
    const salePrice = money(C + fixedFees);
    return {
      jewelleryCost: money(C),
      salePrice,
      etsyAmount: money(salePrice - C),
      variableRate,
      fixedFees,
    };
  }

  const salePrice = money((C + fixedFees) / (1 - variableRate));
  return {
    jewelleryCost: money(C),
    salePrice,
    etsyAmount: money(salePrice - C),
    variableRate,
    fixedFees,
  };
}
