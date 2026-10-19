"use client";

import { useState } from "react";
import { Check, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EtsyCommissionSettings } from "@/types/etsy";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium text-charcoal-muted">
        {label}
      </Label>
      {children}
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Num({
  value,
  onChange,
  step = "0.01",
}: {
  value: number;
  onChange: (n: number) => void;
  step?: string;
}) {
  return (
    <Input
      type="number"
      step={step}
      min={0}
      className="tabular-nums"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  );
}

export function EtsyCommissionForm({
  initialSettings,
}: {
  initialSettings: EtsyCommissionSettings;
}) {
  const [form, setForm] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch<K extends keyof EtsyCommissionSettings>(
    key: K,
    value: EtsyCommissionSettings[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/etsy-commission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as {
        error?: string;
        settings?: EtsyCommissionSettings;
      };
      if (!res.ok) throw new Error(data.error || "Could not save");
      if (data.settings) setForm(data.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-champagne/30 bg-champagne-muted/25 px-4 py-3">
        <Store className="mt-0.5 h-5 w-5 shrink-0 text-champagne" />
        <div>
          <p className="text-sm font-medium text-charcoal">Etsy marketplace</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Admin enabled Etsy for your account. Rates below are estimates —
            verify against your Etsy account and tax rules. Optional charges
            apply only when relevant to an order.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Basic Etsy charges
          </CardTitle>
          <CardDescription>
            Transaction, payment processing, listing, and GST on fees.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Transaction fee (%)">
            <Num
              value={form.transactionFeePercent}
              onChange={(n) => patch("transactionFeePercent", n)}
            />
          </Field>
          <Field label="Payment processing fee (%)">
            <Num
              value={form.paymentProcessingFeePercent}
              onChange={(n) => patch("paymentProcessingFeePercent", n)}
            />
          </Field>
          <Field label="Payment processing fixed (₹)">
            <Num
              value={form.paymentProcessingFixedFeeInr}
              onChange={(n) => patch("paymentProcessingFixedFeeInr", n)}
              step="1"
            />
          </Field>
          <Field label="Regulatory operating fee (%)">
            <Num
              value={form.regulatoryOperatingFeePercent}
              onChange={(n) => patch("regulatoryOperatingFeePercent", n)}
            />
          </Field>
          <Field label="Listing fee (US$)">
            <Num
              value={form.listingFeeUsd}
              onChange={(n) => patch("listingFeeUsd", n)}
            />
          </Field>
          <Field label="GST on Etsy fees (%)">
            <Num
              value={form.gstOnEtsyFeesPercent}
              onChange={(n) => patch("gstOnEtsyFeesPercent", n)}
            />
          </Field>
          <Field label="USD → INR rate" hint="Used to convert listing fees to ₹">
            <Num
              value={form.usdToInrRate}
              onChange={(n) => patch("usdToInrRate", n)}
              step="0.1"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Shipping & other costs
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Shipping cost (₹)">
            <Num
              value={form.shippingCostInr}
              onChange={(n) => patch("shippingCostInr", n)}
              step="1"
            />
          </Field>
          <Field label="Shipping insurance (₹)">
            <Num
              value={form.shippingInsuranceInr}
              onChange={(n) => patch("shippingInsuranceInr", n)}
              step="1"
            />
          </Field>
          <Field label="Packaging cost (₹)">
            <Num
              value={form.packagingCostInr}
              onChange={(n) => patch("packagingCostInr", n)}
              step="1"
            />
          </Field>
          <Field label="Return / replacement reserve (₹)">
            <Num
              value={form.returnReserveInr}
              onChange={(n) => patch("returnReserveInr", n)}
              step="1"
            />
          </Field>
          <Field label="Payoneer withdrawal fee (₹)">
            <Num
              value={form.payoneerWithdrawalFeeInr}
              onChange={(n) => patch("payoneerWithdrawalFeeInr", n)}
              step="1"
            />
          </Field>
          <Field label="Currency conversion fee (%)">
            <Num
              value={form.currencyConversionFeePercent}
              onChange={(n) => patch("currencyConversionFeePercent", n)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Advertising & listing
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Offsite ads fee (%)">
            <Num
              value={form.offsiteAdsFeePercent}
              onChange={(n) => patch("offsiteAdsFeePercent", n)}
            />
          </Field>
          <Field label="Etsy ads cost (₹)">
            <Num
              value={form.etsyAdsCostInr}
              onChange={(n) => patch("etsyAdsCostInr", n)}
              step="1"
            />
          </Field>
          <Field label="Listing renewal fee (US$)">
            <Num
              value={form.listingRenewalFeeUsd}
              onChange={(n) => patch("listingRenewalFeeUsd", n)}
            />
          </Field>
          <Field label="Additional quantity listing (US$)">
            <Num
              value={form.additionalQuantityListingFeeUsd}
              onChange={(n) => patch("additionalQuantityListingFeeUsd", n)}
            />
          </Field>
          <Field label="One-time shop setup fee (₹)">
            <Num
              value={form.oneTimeShopSetupFeeInr}
              onChange={(n) => patch("oneTimeShopSetupFeeInr", n)}
              step="1"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Indian tax deductions
          </CardTitle>
          <CardDescription>
            Tracked separately from business expenses — may be available as tax
            credits.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="TCS deduction (%)">
            <Num
              value={form.tcsDeductionPercent}
              onChange={(n) => patch("tcsDeductionPercent", n)}
            />
          </Field>
          <Field label="TDS deduction (%)">
            <Num
              value={form.tdsDeductionPercent}
              onChange={(n) => patch("tdsDeductionPercent", n)}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save Etsy rates"}
        </Button>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-800">
            <Check className="h-4 w-4" />
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
