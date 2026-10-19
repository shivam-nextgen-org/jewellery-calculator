"use client";

import { useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/format";
import {
  DEFAULT_ETSY_APPLICABLE,
  calculateEtsyBreakdown,
  calculateEtsyInclusiveSalePrice,
  type EtsyApplicableFlags,
} from "@/lib/etsy/calculate-breakdown";
import {
  parseEtsyCommission,
  type EtsyCommissionSettings,
} from "@/types/etsy";

type EditableKeys = keyof EtsyCommissionSettings;

const EDITABLE_FIELDS: { key: EditableKeys; label: string; step?: string }[] = [
  { key: "transactionFeePercent", label: "Transaction fee (%)" },
  { key: "paymentProcessingFeePercent", label: "Payment processing (%)" },
  {
    key: "paymentProcessingFixedFeeInr",
    label: "Payment processing fixed (₹)",
    step: "1",
  },
  { key: "regulatoryOperatingFeePercent", label: "Regulatory fee (%)" },
  { key: "listingFeeUsd", label: "Listing fee (US$)" },
  { key: "gstOnEtsyFeesPercent", label: "GST on Etsy fees (%)" },
  { key: "usdToInrRate", label: "USD → INR", step: "0.1" },
  { key: "shippingCostInr", label: "Shipping (₹)", step: "1" },
  { key: "shippingInsuranceInr", label: "Shipping insurance (₹)", step: "1" },
  { key: "packagingCostInr", label: "Packaging (₹)", step: "1" },
  { key: "returnReserveInr", label: "Return reserve (₹)", step: "1" },
  { key: "payoneerWithdrawalFeeInr", label: "Payoneer fee (₹)", step: "1" },
  { key: "currencyConversionFeePercent", label: "Currency conversion (%)" },
  { key: "offsiteAdsFeePercent", label: "Offsite ads (%)" },
  { key: "etsyAdsCostInr", label: "Etsy ads (₹)", step: "1" },
  { key: "listingRenewalFeeUsd", label: "Listing renewal (US$)" },
  {
    key: "additionalQuantityListingFeeUsd",
    label: "Extra qty listing (US$)",
  },
  { key: "oneTimeShopSetupFeeInr", label: "Shop setup (₹)", step: "1" },
  { key: "tcsDeductionPercent", label: "TCS (%)" },
  { key: "tdsDeductionPercent", label: "TDS (%)" },
];

export function EtsyBreakdownDialog({
  open,
  onOpenChange,
  productCost,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productCost: number;
  defaults: EtsyCommissionSettings;
}) {
  const [salePrice, setSalePrice] = useState(productCost);
  const [settings, setSettings] = useState(defaults);
  const [applicable, setApplicable] =
    useState<EtsyApplicableFlags>(DEFAULT_ETSY_APPLICABLE);
  const [editRates, setEditRates] = useState(false);

  useEffect(() => {
    if (!open) return;
    const parsed = parseEtsyCommission(defaults);
    const inclusive = calculateEtsyInclusiveSalePrice({
      productCost,
      settings: parsed,
    });
    setSalePrice(inclusive.salePrice);
    setSettings(parsed);
    setApplicable(DEFAULT_ETSY_APPLICABLE);
    setEditRates(false);
  }, [open, productCost, defaults]);

  const result = useMemo(
    () =>
      calculateEtsyBreakdown({
        productCost,
        salePrice,
        settings,
        applicable,
      }),
    [productCost, salePrice, settings, applicable],
  );

  function resetToDefaults() {
    const parsed = parseEtsyCommission(defaults);
    const inclusive = calculateEtsyInclusiveSalePrice({
      productCost,
      settings: parsed,
    });
    setSettings(parsed);
    setSalePrice(inclusive.salePrice);
    setApplicable(DEFAULT_ETSY_APPLICABLE);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-champagne" />
            Etsy breakdown
          </DialogTitle>
          <DialogDescription>
            Estimated fees for this design. Edit sale price or rates, then
            review profit. TCS/TDS are shown separately from expenses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Product cost (jewellery)</Label>
              <Input
                type="number"
                className="tabular-nums"
                value={result.productCost}
                readOnly
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sale / listing price (₹)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                className="tabular-nums"
                value={salePrice}
                onChange={(e) => setSalePrice(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/80 bg-ivory/40 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Apply when applicable
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["currencyConversion", "Currency conversion"],
                  ["offsiteAds", "Offsite ads"],
                  ["listingRenewal", "Listing renewal"],
                  ["additionalQuantityListing", "Additional qty listing"],
                  ["shopSetup", "One-time shop setup"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 text-sm text-charcoal"
                >
                  <Checkbox
                    checked={applicable[key]}
                    onCheckedChange={(v) =>
                      setApplicable((prev) => ({ ...prev, [key]: v === true }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-charcoal">Fee lines</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditRates((v) => !v)}
            >
              {editRates ? "Hide rate edits" : "Edit rates"}
            </Button>
          </div>

          {editRates ? (
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-border/70 p-3 sm:grid-cols-2">
              {EDITABLE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-xs">{field.label}</Label>
                  <Input
                    type="number"
                    step={field.step ?? "0.01"}
                    min={0}
                    className="h-8 tabular-nums"
                    value={settings[field.key]}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        [field.key]: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-border/80">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border/60">
                <tr className="bg-ivory-deep/40">
                  <td className="px-3 py-2 text-muted-foreground">
                    Product cost
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatINR(result.productCost)}
                  </td>
                </tr>
                {result.lines
                  .filter((l) => !l.isTaxCredit && l.amount !== 0)
                  .map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2 text-muted-foreground">
                        {line.label}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-charcoal">
                        {formatINR(line.amount)}
                      </td>
                    </tr>
                  ))}
                <tr className="bg-ivory-deep/50 font-medium">
                  <td className="px-3 py-2">Total expenses</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatINR(result.totalExpenses)}
                  </td>
                </tr>
                {result.lines
                  .filter((l) => l.isTaxCredit)
                  .map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2 text-muted-foreground">
                        {line.label}{" "}
                        <span className="text-[10px] uppercase tracking-wide">
                          (tax credit)
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatINR(line.amount)}
                      </td>
                    </tr>
                  ))}
                <tr className="bg-champagne-muted/40 font-semibold">
                  <td className="px-3 py-2.5">Net profit</td>
                  <td
                    className={
                      "px-3 py-2.5 text-right tabular-nums " +
                      (result.netProfit < 0
                        ? "text-destructive"
                        : "text-charcoal")
                    }
                  >
                    {formatINR(result.netProfit)}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 text-muted-foreground">
                    Profit margin
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {result.profitMarginPercent.toFixed(2)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={resetToDefaults}>
            Reset to settings
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
