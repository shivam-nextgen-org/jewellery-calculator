/**
 * Per-user Etsy commission rates (user Settings, only when admin enabled Etsy).
 * Admin only toggles `etsyEnabled` on the User. Rates live in AppSetting.
 * All values are estimates — verify against live Etsy / tax rules.
 */
export interface EtsyCommissionSettings {
  /** Basic Etsy charges */
  transactionFeePercent: number;
  paymentProcessingFeePercent: number;
  paymentProcessingFixedFeeInr: number;
  regulatoryOperatingFeePercent: number;
  listingFeeUsd: number;
  gstOnEtsyFeesPercent: number;

  /** Shipping & other */
  shippingCostInr: number;
  shippingInsuranceInr: number;
  packagingCostInr: number;
  returnReserveInr: number;
  payoneerWithdrawalFeeInr: number;
  currencyConversionFeePercent: number;

  /** Advertising & listing */
  offsiteAdsFeePercent: number;
  etsyAdsCostInr: number;
  listingRenewalFeeUsd: number;
  additionalQuantityListingFeeUsd: number;
  oneTimeShopSetupFeeInr: number;

  /** Indian tax (tracked separately from expenses) */
  tcsDeductionPercent: number;
  tdsDeductionPercent: number;

  /** USD → INR for listing fees (admin estimate) */
  usdToInrRate: number;
}

export const DEFAULT_ETSY_COMMISSION: EtsyCommissionSettings = {
  transactionFeePercent: 6.5,
  paymentProcessingFeePercent: 5,
  paymentProcessingFixedFeeInr: 25,
  regulatoryOperatingFeePercent: 0.05,
  listingFeeUsd: 0.2,
  gstOnEtsyFeesPercent: 18,

  shippingCostInr: 2500,
  shippingInsuranceInr: 500,
  packagingCostInr: 0,
  returnReserveInr: 0,
  payoneerWithdrawalFeeInr: 0,
  currencyConversionFeePercent: 2.5,

  offsiteAdsFeePercent: 15,
  etsyAdsCostInr: 0,
  listingRenewalFeeUsd: 0.2,
  additionalQuantityListingFeeUsd: 0.2,
  oneTimeShopSetupFeeInr: 0,

  tcsDeductionPercent: 0.5,
  tdsDeductionPercent: 0.1,

  usdToInrRate: 84,
};

export function parseEtsyCommission(
  value: unknown,
): EtsyCommissionSettings {
  const raw = (value ?? {}) as Partial<EtsyCommissionSettings>;
  return { ...DEFAULT_ETSY_COMMISSION, ...raw };
}
