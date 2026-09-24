"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/brand/video-loader";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import type { GoldPurityOption, PricingDefaults } from "@/types/jewellery";

// Purity groups, in a sensible display order.
const GOLD_PURITIES: GoldPurityOption[] = ["24K", "22K", "18K", "14K", "10K", "9K"];
const SILVER_PURITIES: GoldPurityOption[] = ["925", "958", "999"];

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
      <Label className="normal-case tracking-normal text-[13px] font-medium text-charcoal-muted">
        {label}
      </Label>
      {children}
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function PurityField({
  purity,
  value,
  onChange,
}: {
  purity: GoldPurityOption;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={purity}>
      <NumberInput step="0.01" value={value} onValueChange={onChange} />
    </Field>
  );
}

export function PricingDefaultsForm({
  initialDefaults,
}: {
  initialDefaults: PricingDefaults;
}) {
  const [form, setForm] = useState<PricingDefaults>(initialDefaults);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Default diamond discount is opt-in — the field only opens when checked.
  const [discountEnabled, setDiscountEnabled] = useState<boolean>(
    () => (initialDefaults.defaultDiamondDiscount ?? 0) > 0,
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/pricing-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Save failed");
      }
      const savedBody = (await res.json()) as PricingDefaults;
      setForm(savedBody);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setForm(MOCK_PRICING_DEFAULTS);
    setDiscountEnabled((MOCK_PRICING_DEFAULTS.defaultDiamondDiscount ?? 0) > 0);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/pricing-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(MOCK_PRICING_DEFAULTS),
      });
      if (!res.ok) throw new Error("Reset failed");
      const savedBody = (await res.json()) as PricingDefaults;
      setForm(savedBody);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {saving ? <PageLoader label="Saving settings…" /> : null}

      {error && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Gold &amp; Silver defaults
          </CardTitle>
          <CardDescription>
            Stored in MongoDB. Workspace preloads these on open.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field
            label="24K Gold Rate (₹ / gram)"
            hint="You can still change the rate per design in the workspace."
          >
            <NumberInput
              value={form.gold24kRate}
              onValueChange={(n) =>
                setForm((d) => ({ ...d, gold24kRate: n }))
              }
            />
          </Field>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-champagne" />
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-charcoal">
                Gold purity %
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {GOLD_PURITIES.map((purity) => (
                <PurityField
                  key={purity}
                  purity={purity}
                  value={form.purityPercentages[purity]}
                  onChange={(n) =>
                    setForm((d) => ({
                      ...d,
                      purityPercentages: {
                        ...d.purityPercentages,
                        [purity]: n,
                      },
                    }))
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-charcoal-muted" />
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-charcoal">
                Silver purity %
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SILVER_PURITIES.map((purity) => (
                <PurityField
                  key={purity}
                  purity={purity}
                  value={form.purityPercentages[purity]}
                  onChange={(n) =>
                    setForm((d) => ({
                      ...d,
                      purityPercentages: {
                        ...d.purityPercentages,
                        [purity]: n,
                      },
                    }))
                  }
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Diamond defaults
          </CardTitle>
          <CardDescription>
            Separate rates for Natural and Lab Grown — used in variation
            pricing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Natural Diamond Rate (₹ / CT)">
            <NumberInput
              value={form.defaultDiamondRateNatural}
              onValueChange={(n) =>
                setForm((d) => ({
                  ...d,
                  defaultDiamondRateNatural: n,
                  defaultDiamondRate: n,
                }))
              }
            />
          </Field>
          <Field label="Lab Grown Diamond Rate (₹ / CT)">
            <NumberInput
              value={form.defaultDiamondRateLabGrown}
              onValueChange={(n) =>
                setForm((d) => ({ ...d, defaultDiamondRateLabGrown: n }))
              }
            />
          </Field>
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[13px] font-medium text-charcoal-muted">
              <Checkbox
                checked={discountEnabled}
                onCheckedChange={(value) => {
                  const on = value === true;
                  setDiscountEnabled(on);
                  if (!on) {
                    setForm((d) => ({ ...d, defaultDiamondDiscount: 0 }));
                  }
                }}
              />
              Apply default diamond discount (%)
            </label>
            <NumberInput
              value={form.defaultDiamondDiscount}
              disabled={!discountEnabled}
              onValueChange={(n) =>
                setForm((d) => ({ ...d, defaultDiamondDiscount: n }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Charge defaults
          </CardTitle>
          <CardDescription>
            Making and other charges preload into the pricing workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Default Making Charge (₹)">
            <NumberInput
              value={form.defaultMakingCharge}
              onValueChange={(n) =>
                setForm((d) => ({ ...d, defaultMakingCharge: n }))
              }
            />
          </Field>
          <Field label="Making calculation type">
            <select
              className="flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
              value={form.defaultMakingCalcType}
              onChange={(e) =>
                setForm((d) => ({
                  ...d,
                  defaultMakingCalcType: e.target
                    .value as PricingDefaults["defaultMakingCalcType"],
                }))
              }
            >
              <option value="per-gram">Per Gram</option>
              <option value="fixed">Fixed</option>
              <option value="percentage">Percentage</option>
            </select>
          </Field>
          <Field label="Default Other Charge (₹)">
            <NumberInput
              value={form.defaultOtherCharge}
              onValueChange={(n) =>
                setForm((d) => ({ ...d, defaultOtherCharge: n }))
              }
            />
          </Field>
          <Field label="Other charge type">
            <select
              className="flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
              value={form.defaultOtherCalcType}
              onChange={(e) =>
                setForm((d) => ({
                  ...d,
                  defaultOtherCalcType: e.target
                    .value as PricingDefaults["defaultOtherCalcType"],
                }))
              }
            >
              <option value="fixed">Fixed</option>
              <option value="per-gram">Per Gram</option>
              <option value="percentage">Percentage</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={saving}>
          Reset to app defaults
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[var(--success)]">
            <Check className="h-4 w-4" />
            Saved to database
          </span>
        )}
      </div>
    </div>
  );
}
