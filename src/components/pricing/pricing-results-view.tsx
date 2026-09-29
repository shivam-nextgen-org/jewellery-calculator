"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VariationResultsTable } from "@/components/pricing/variation-results";
import { downloadVariationPricesExcel } from "@/lib/excel/export-variations";
import { formatMoney } from "@/lib/fx/format-money";
import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  type SupportedCurrency,
} from "@/lib/fx/currencies";
import { formatWeight } from "@/lib/format";
import {
  calculateAllVariations,
  countVariations,
  getPriceRange,
  validatePricingSession,
  type PricingSessionInput,
  type VariationOverrides,
} from "@/lib/pricing-engine";
import {
  loadPricingDraft,
  savePricingDraft,
  type PricingDraft,
} from "@/lib/pricing-draft";

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-charcoal">
        {value}
      </span>
    </div>
  );
}

export function PricingResultsView() {
  const router = useRouter();
  const [draft, setDraft] = useState<PricingDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<SupportedCurrency>("INR");
  const [fxRates, setFxRates] = useState<Partial<Record<string, number>> | null>(
    { INR: 1 },
  );
  const [fxCapturedAt, setFxCapturedAt] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setDraft(loadPricingDraft()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/fx-rates/current");
        if (!res.ok) return;
        const body = (await res.json()) as {
          rates?: Partial<Record<string, number>>;
          capturedAt?: string | null;
        };
        if (cancelled) return;
        const rates = body.rates ?? { INR: 1 };
        setFxRates(rates);
        setFxCapturedAt(body.capturedAt ?? null);
      } catch {
        // Keep INR identity rates — display still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasFxRates = Boolean(
    fxRates &&
      Object.keys(fxRates).some((k) => k !== "INR" && Number(fxRates[k]) > 0),
  );

  const sessionInput: PricingSessionInput | null = useMemo(() => {
    if (!draft) return null;
    return {
      netWeight: draft.extracted.netWeight,
      diamondWeight: draft.extracted.diamondWeight,
      gold24kRate: draft.pricing.gold24kRate,
      purityPercentages: draft.purityPercentages,
      metals: draft.selection.metals,
      purities: draft.selection.purities,
      colors: draft.selection.colors,
      diamondTypes: draft.selection.diamondTypes?.length
        ? draft.selection.diamondTypes
        : ["natural", "lab-grown"],
      diamondRateNatural:
        draft.pricing.diamondRateNatural ??
        (draft.pricing as { diamondRate?: number }).diamondRate ??
        100000,
      diamondRateLabGrown: draft.pricing.diamondRateLabGrown ?? 45000,
      diamondRateMoissanite: draft.pricing.diamondRateMoissanite ?? 8000,
      diamondDiscountPercent: draft.pricing.diamondDiscount,
      makingCharge: draft.pricing.makingCharge,
      makingCalcType: draft.pricing.makingCalcType,
      otherCharges: draft.pricing.otherCharges.map((c) => ({
        id: c.id,
        name: c.name,
        amount: c.amount,
        calcType: c.calcType,
      })),
      overridesByVariationId: draft.overridesByVariationId,
    };
  }, [draft]);

  const validationIssues = useMemo(
    () => (sessionInput ? validatePricingSession(sessionInput) : []),
    [sessionInput],
  );

  const pricedVariations = useMemo(() => {
    if (!sessionInput || validationIssues.length > 0) return [];
    return calculateAllVariations(sessionInput);
  }, [sessionInput, validationIssues.length]);

  const variationCount = draft
    ? countVariations(
        draft.selection.metals,
        draft.selection.purities,
        draft.selection.colors,
        draft.selection.diamondTypes?.length
          ? draft.selection.diamondTypes
          : ["natural", "lab-grown"],
      )
    : 0;

  const priceRange = useMemo(
    () => getPriceRange(pricedVariations),
    [pricedVariations],
  );

  function persist(next: PricingDraft) {
    setDraft(next);
    savePricingDraft(next);
  }

  function setOverride(id: string, overrides: VariationOverrides) {
    if (!draft) return;
    persist({
      ...draft,
      overridesByVariationId: {
        ...draft.overridesByVariationId,
        [id]: overrides,
      },
    });
  }

  function clearOverride(id: string) {
    if (!draft) return;
    const nextOverrides = { ...draft.overridesByVariationId };
    delete nextOverrides[id];
    persist({ ...draft, overridesByVariationId: nextOverrides });
  }

  function clearAllOverrides() {
    if (!draft) return;
    persist({ ...draft, overridesByVariationId: {} });
  }

  function handleExportExcel() {
    if (!draft || pricedVariations.length === 0) return;
    downloadVariationPricesExcel(pricedVariations, {
      designNo: draft.extracted.designNo,
      category: draft.extracted.category,
      netWeight: draft.extracted.netWeight,
      diamondWeight: draft.extracted.diamondWeight,
      currency,
      rates: fxRates,
    });
  }

  async function handleSaveProduct() {
    if (!draft || validationIssues.length > 0 || pricedVariations.length === 0) {
      setSaveError("Fix validation issues before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extracted: draft.extracted,
          pricing: draft.pricing,
          selection: draft.selection,
          purityPercentages: draft.purityPercentages,
          imageFileName: draft.excelFileName ?? draft.imageName,
          overridesByVariationId: draft.overridesByVariationId,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        designNo?: string;
        variationCount?: number;
      };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setSaveMessage(
        `Saved ${body.designNo} · ${body.variationCount} variations (snapshot locked)`,
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!draft || !draft.calculatedAt) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
            Jewellery Pricing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
            Variation results
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No calculated results yet. Set rates and click Calculate first.
          </p>
        </div>
        <Button asChild variant="champagne">
          <Link href="/pricing">Go to Pricing Workspace</Link>
        </Button>
      </div>
    );
  }

  const { extracted, pricing } = draft;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
            Jewellery Pricing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
            Variation results
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Full price table for this design. Expand a row for breakdown, or
            edit rates and calculate again.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (draft) {
              const hasExcel =
                Boolean(draft.excelFileName) ||
                Boolean(draft.excelRows?.length) ||
                draft.entryMode === "excel";
              const nextStep = hasExcel ? "verify" : "price";
              savePricingDraft({
                ...draft,
                step: nextStep,
                resume: true,
              });
              router.push(`/pricing?step=${nextStep}`);
            } else {
              router.push("/pricing?step=import");
            }
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to pricing
        </Button>
      </div>

      {validationIssues.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {validationIssues.map((issue) => (
            <p key={issue.field}>{issue.message}</p>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl">{extracted.designNo}</CardTitle>
            <CardDescription className="mt-1">
              {extracted.category}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Currency</span>
              <select
                className="h-8 rounded-md border border-input bg-surface-elevated px-2 text-sm text-charcoal"
                value={currency}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isSupportedCurrency(next)) setCurrency(next);
                }}
                aria-label="Display currency"
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            {currency !== "INR" && !hasFxRates ? (
              <span className="text-xs text-destructive">
                No FX snapshot — Settings → Update Currency Rates
              </span>
            ) : null}
            <Badge className="border-champagne/40 bg-champagne-muted/60 px-3 py-1 text-sm font-semibold text-charcoal">
              {variationCount} variation
              {variationCount === 1 ? "" : "s"}
            </Badge>
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatMoney(priceRange.min, currency, fxRates, {
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
              })}{" "}
              –{" "}
              {formatMoney(priceRange.max, currency, fxRates, {
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
              })}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <DataRow
              label="Gold"
              value={`${extracted.goldPurity} ${extracted.goldColor}`}
            />
            <DataRow
              label="Net Weight"
              value={formatWeight(extracted.netWeight)}
            />
            <DataRow
              label="Diamond"
              value={`${formatWeight(extracted.diamondWeight, "CT")} · ${extracted.diamondType || "—"}`}
            />
            <DataRow
              label="Pieces"
              value={String(extracted.diamondPieces)}
            />
            <DataRow
              label="Total variations"
              value={String(variationCount)}
            />
            <DataRow
              label="Price range"
              value={`${formatMoney(priceRange.min, currency, fxRates, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} – ${formatMoney(priceRange.max, currency, fxRates, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button
              size="sm"
              onClick={() => void handleSaveProduct()}
              disabled={saving || validationIssues.length > 0}
            >
              {saving ? "Saving…" : "Save Product"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportExcel}
              disabled={pricedVariations.length === 0 || validationIssues.length > 0}
            >
              Export Excel
            </Button>
            <Button size="sm" variant="outline" onClick={clearAllOverrides}>
              Clear overrides
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                savePricingDraft({ ...draft, step: "verify", resume: true });
                router.push("/pricing?step=verify");
              }}
            >
              {draft.entryMode === "excel" || draft.excelRows?.length
                ? "Choose another row"
                : "Edit Data"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                savePricingDraft({ ...draft, step: "price", resume: true });
                router.push("/pricing?step=price");
              }}
            >
              Edit Rates
            </Button>
          </div>
          {saveMessage && (
            <p className="pt-2 text-sm text-[var(--success)]">{saveMessage}</p>
          )}
          {saveError && (
            <p className="pt-2 text-sm text-destructive">{saveError}</p>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Variation prices
            </h2>
            <p className="text-sm text-muted-foreground">
              {variationCount} combination
              {variationCount === 1 ? "" : "s"} calculated
              {fxCapturedAt && currency !== "INR"
                ? ` · FX snapshot ${new Date(fxCapturedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
                : ""}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Expand row for breakdown · pencil for overrides
          </p>
        </div>
        <VariationResultsTable
          variations={pricedVariations}
          netWeight={extracted.netWeight}
          diamondWeight={extracted.diamondWeight}
          onOverride={setOverride}
          onClearOverride={clearOverride}
          currency={currency}
          rates={fxRates}
        />
      </div>
    </div>
  );
}
