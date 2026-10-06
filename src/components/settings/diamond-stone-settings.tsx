"use client";

import { useEffect, useState } from "react";
import { NumberInput } from "@/components/ui/number-input";
import { formatINR } from "@/lib/format";
import {
  calculateRateFromGradeProfile,
  formatAdjustmentPercent,
  parsePercentageInput,
  stoneTypeLabel,
} from "@/lib/pricing-engine";
import { cn } from "@/lib/utils";
import type {
  DiamondTypeOption,
  PricingCalculationMethod,
  PricingGradeRule,
  PricingProfile,
  PricingProfileInput,
} from "@/types/jewellery";

export const STONE_TYPES: DiamondTypeOption[] = [
  "natural",
  "lab-grown",
  "moissanite",
];

const STONE_HINT: Record<DiamondTypeOption, string> = {
  natural: "Mined diamond — typically quoted from a G / VS1 base.",
  "lab-grown": "Lab-grown diamond — same grades as natural; own ₹/ct base.",
  moissanite: "Moissanite — commercial colour & clarity bands, not GIA scale.",
};

export type StoneProfileDraft = {
  id: string;
  updatedAt: string;
  name: string;
  stoneType: DiamondTypeOption;
  basePricePerCt: number;
  baseColorGrade: string;
  baseClarityGrade: string;
  calculationMethod: PricingCalculationMethod;
  colorRules: PricingGradeRule[];
  clarityRules: PricingGradeRule[];
};

function profileToDraft(profile: PricingProfile): StoneProfileDraft {
  return {
    id: profile.id,
    updatedAt: profile.updatedAt,
    name: profile.name,
    stoneType: profile.stoneType,
    basePricePerCt: profile.basePricePerCt,
    baseColorGrade: profile.baseColorGrade,
    baseClarityGrade: profile.baseClarityGrade,
    calculationMethod: profile.calculationMethod,
    colorRules: profile.colorRules.map((r) => ({ ...r })),
    clarityRules: profile.clarityRules.map((r) => ({ ...r })),
  };
}

function GradePercentRow({
  grade,
  percent,
  isBase,
  onChange,
  onMakeBase,
  previewRate,
}: {
  grade: string;
  percent: number;
  isBase: boolean;
  onChange: (n: number) => void;
  onMakeBase: () => void;
  previewRate: number;
}) {
  const [text, setText] = useState(() => String(percent));
  useEffect(() => {
    if (parsePercentageInput(text) !== percent) setText(String(percent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(4.5rem,auto)] items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0",
        isBase && "bg-champagne-muted/30",
      )}
    >
      <button
        type="button"
        onClick={onMakeBase}
        className="flex min-w-0 items-center gap-2 text-left"
        title={isBase ? "Base grade (0%)" : `Set ${grade} as base`}
      >
        <span className="truncate text-sm font-semibold text-charcoal">{grade}</span>
        {isBase ? (
          <span className="shrink-0 rounded-full bg-champagne/20 px-1.5 py-0.5 text-[10px] font-medium text-charcoal">
            Base
          </span>
        ) : null}
      </button>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          disabled={isBase}
          aria-label={`${grade} percent`}
          value={isBase ? "0" : text}
          onChange={(e) => {
            setText(e.target.value);
            const parsed = parsePercentageInput(e.target.value);
            if (parsed != null) onChange(parsed);
          }}
          onBlur={() => {
            const next = parsePercentageInput(text) ?? 0;
            setText(String(next));
            onChange(next);
          }}
          className={cn(
            "h-8 w-full rounded-md border border-input bg-surface px-2 pr-6 text-right text-sm tabular-nums",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/40",
            isBase && "cursor-not-allowed opacity-60",
          )}
        />
        <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px] text-muted-foreground">
          %
        </span>
      </div>
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {isBase
          ? formatAdjustmentPercent(0)
          : `${formatAdjustmentPercent(percent)} · ${formatINR(previewRate, { maximumFractionDigits: 0 })}`}
      </span>
    </div>
  );
}

function previewFor(
  draft: StoneProfileDraft,
  colorPct: number,
  clarityPct: number,
): number {
  return Number(
    calculateRateFromGradeProfile({
      basePricePerCt: draft.basePricePerCt,
      colorRules: [{ grade: "c", adjustmentPercent: colorPct }],
      clarityRules: [{ grade: "cl", adjustmentPercent: clarityPct }],
      colorGrade: "c",
      clarityGrade: "cl",
      calculationMethod: draft.calculationMethod,
    }).ratePerCt,
  );
}

function MethodExample({
  method,
  basePrice,
}: {
  method: PricingCalculationMethod;
  basePrice: number;
}) {
  const base = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 100_000;
  const colourPct = 20;
  const clarityPct = 15;

  if (method === "additive") {
    const totalPct = colourPct + clarityPct;
    const final = Math.round((base * (100 + totalPct)) / 100);
    return (
      <div className="rounded-xl border border-champagne/40 bg-champagne-muted/20 px-3 py-2.5 text-xs leading-relaxed text-charcoal">
        <p className="font-medium text-charcoal">Additive example</p>
        <p className="mt-1 tabular-nums text-charcoal-muted">
          Colour +{colourPct}% + Clarity +{clarityPct}% ={" "}
          <span className="font-medium text-charcoal">+{totalPct}%</span>
        </p>
        <p className="mt-0.5 tabular-nums text-charcoal-muted">
          {formatINR(base, { maximumFractionDigits: 0 })} × 1.{totalPct} ={" "}
          <span className="font-semibold text-charcoal">
            {formatINR(final, { maximumFractionDigits: 0 })}
          </span>
          <span className="text-muted-foreground"> / ct</span>
        </p>
      </div>
    );
  }

  const afterColour = Math.round((base * (100 + colourPct)) / 100);
  const final = Math.round((afterColour * (100 + clarityPct)) / 100);
  return (
    <div className="rounded-xl border border-border/70 bg-ivory-deep/50 px-3 py-2.5 text-xs leading-relaxed text-charcoal">
      <p className="font-medium text-charcoal">Sequential example</p>
      <p className="mt-1 tabular-nums text-charcoal-muted">
        {formatINR(base, { maximumFractionDigits: 0 })} × 1.{colourPct} ={" "}
        {formatINR(afterColour, { maximumFractionDigits: 0 })}
      </p>
      <p className="mt-0.5 tabular-nums text-charcoal-muted">
        then × 1.{clarityPct} ={" "}
        <span className="font-semibold text-charcoal">
          {formatINR(final, { maximumFractionDigits: 0 })}
        </span>
        <span className="text-muted-foreground"> / ct</span>
      </p>
    </div>
  );
}

function StoneCard({
  draft,
  onChange,
  discountPercent,
  onDiscountChange,
}: {
  draft: StoneProfileDraft;
  onChange: (next: StoneProfileDraft) => void;
  discountPercent: number;
  onDiscountChange: (n: number) => void;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_1px_2px_rgba(26,24,22,0.04)]">
      <header className="border-b border-border/60 bg-gradient-to-r from-indigo-50/80 via-surface to-surface px-4 py-4 sm:px-5">
        {/* Full-width stone identity */}
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold tracking-tight text-charcoal">
            {stoneTypeLabel(draft.stoneType)}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {STONE_HINT[draft.stoneType]}
          </p>
        </div>

        {/* Two equal columns: base inputs | method */}
        <div className="mt-4 grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-8">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor={`base-${draft.stoneType}`}
                  className="block text-[11px] font-medium uppercase tracking-wide text-charcoal-muted"
                >
                  Base ₹ / ct
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    ₹
                  </span>
                  <NumberInput
                    id={`base-${draft.stoneType}`}
                    value={draft.basePricePerCt}
                    onValueChange={(n) =>
                      onChange({ ...draft, basePricePerCt: n })
                    }
                    className="h-10 pl-7 pr-10 font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] text-muted-foreground">
                    /ct
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor={`discount-${draft.stoneType}`}
                  className="block text-[11px] font-medium uppercase tracking-wide text-charcoal-muted"
                >
                  Discount
                </label>
                <div className="relative">
                  <NumberInput
                    id={`discount-${draft.stoneType}`}
                    value={discountPercent}
                    onValueChange={onDiscountChange}
                    aria-label={`${stoneTypeLabel(draft.stoneType)} discount percent`}
                    className="h-10 pr-8 font-medium tabular-nums"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor={`base-color-${draft.stoneType}`}
                  className="block text-[11px] font-medium uppercase tracking-wide text-charcoal-muted"
                >
                  Base colour
                </label>
                <select
                  id={`base-color-${draft.stoneType}`}
                  className="app-select h-10 w-full rounded-md border border-input bg-surface pl-3 text-sm font-medium text-charcoal"
                  value={draft.baseColorGrade}
                  onChange={(e) => {
                    const grade = e.target.value;
                    onChange({
                      ...draft,
                      baseColorGrade: grade,
                      colorRules: draft.colorRules.map((r) =>
                        r.grade === grade
                          ? { ...r, adjustmentPercent: 0 }
                          : r,
                      ),
                    });
                  }}
                >
                  {draft.colorRules.map((r) => (
                    <option key={r.grade} value={r.grade}>
                      {r.grade}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor={`base-clarity-${draft.stoneType}`}
                  className="block text-[11px] font-medium uppercase tracking-wide text-charcoal-muted"
                >
                  Base clarity
                </label>
                <select
                  id={`base-clarity-${draft.stoneType}`}
                  className="app-select h-10 w-full rounded-md border border-input bg-surface pl-3 text-sm font-medium text-charcoal"
                  value={draft.baseClarityGrade}
                  onChange={(e) => {
                    const grade = e.target.value;
                    onChange({
                      ...draft,
                      baseClarityGrade: grade,
                      clarityRules: draft.clarityRules.map((r) =>
                        r.grade === grade
                          ? { ...r, adjustmentPercent: 0 }
                          : r,
                      ),
                    });
                  }}
                >
                  {draft.clarityRules.map((r) => (
                    <option key={r.grade} value={r.grade}>
                      {r.grade}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Base grades stay at{" "}
              <span className="font-medium text-charcoal">0%</span>. Other
              colours and clarities are +/- from{" "}
              <span className="font-medium tabular-nums text-charcoal">
                {draft.baseColorGrade}-{draft.baseClarityGrade}
              </span>
              . Discount{" "}
              <span className="font-medium tabular-nums text-charcoal">
                {discountPercent}%
              </span>{" "}
              comes off this stone&apos;s diamond value
              {discountPercent === 0 ? " (off when 0)" : ""}.
            </p>
          </div>

          <div className="space-y-2.5 lg:border-l lg:border-border/50 lg:pl-8">
            <fieldset>
              <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-charcoal-muted">
                How % apply
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: "additive" as const,
                      label: "Additive",
                      blurb: "Colour % + Clarity %",
                    },
                    {
                      id: "sequential" as const,
                      label: "Sequential",
                      blurb: "Colour %, then Clarity %",
                    },
                  ] as const
                ).map((opt) => {
                  const active = draft.calculationMethod === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onChange({ ...draft, calculationMethod: opt.id })
                      }
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left transition-colors",
                        active
                          ? "border-champagne/60 bg-champagne-muted/25 shadow-sm"
                          : "border-border/70 bg-surface-elevated hover:border-champagne-soft",
                      )}
                    >
                      <span className="block text-sm font-semibold text-charcoal">
                        {opt.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {opt.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <MethodExample
              method={draft.calculationMethod}
              basePrice={draft.basePricePerCt}
            />
          </div>
        </div>
      </header>

      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border/60">
        <div className="p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-charcoal">Colour</h4>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              Base {draft.baseColorGrade} = 0%
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(4.5rem,auto)] gap-2 border-b border-border/60 bg-ivory-deep/50 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-charcoal-muted">
              <span>Grade</span>
              <span className="text-right">Adj.</span>
              <span className="text-right">Result</span>
            </div>
            {draft.colorRules.map((rule) => {
              const pct =
                rule.grade === draft.baseColorGrade
                  ? 0
                  : rule.adjustmentPercent;
              return (
                <GradePercentRow
                  key={rule.grade}
                  grade={rule.grade}
                  percent={pct}
                  isBase={rule.grade === draft.baseColorGrade}
                  previewRate={previewFor(draft, pct, 0)}
                  onMakeBase={() =>
                    onChange({
                      ...draft,
                      baseColorGrade: rule.grade,
                      colorRules: draft.colorRules.map((r) =>
                        r.grade === rule.grade
                          ? { ...r, adjustmentPercent: 0 }
                          : r,
                      ),
                    })
                  }
                  onChange={(n) =>
                    onChange({
                      ...draft,
                      colorRules: draft.colorRules.map((r) =>
                        r.grade === rule.grade
                          ? { ...r, adjustmentPercent: n }
                          : r,
                      ),
                    })
                  }
                />
              );
            })}
          </div>
        </div>

        <div className="border-t border-border/60 p-3 sm:p-4 md:border-t-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-charcoal">Clarity</h4>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              Base {draft.baseClarityGrade} = 0%
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(4.5rem,auto)] gap-2 border-b border-border/60 bg-ivory-deep/50 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-charcoal-muted">
              <span>Grade</span>
              <span className="text-right">Adj.</span>
              <span className="text-right">Result</span>
            </div>
            {draft.clarityRules.map((rule) => {
              const pct =
                rule.grade === draft.baseClarityGrade
                  ? 0
                  : rule.adjustmentPercent;
              return (
                <GradePercentRow
                  key={rule.grade}
                  grade={rule.grade}
                  percent={pct}
                  isBase={rule.grade === draft.baseClarityGrade}
                  previewRate={previewFor(draft, 0, pct)}
                  onMakeBase={() =>
                    onChange({
                      ...draft,
                      baseClarityGrade: rule.grade,
                      clarityRules: draft.clarityRules.map((r) =>
                        r.grade === rule.grade
                          ? { ...r, adjustmentPercent: 0 }
                          : r,
                      ),
                    })
                  }
                  onChange={(n) =>
                    onChange({
                      ...draft,
                      clarityRules: draft.clarityRules.map((r) =>
                        r.grade === rule.grade
                          ? { ...r, adjustmentPercent: n }
                          : r,
                      ),
                    })
                  }
                />
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-border/60", className)}
      aria-hidden
    />
  );
}

function GradeTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <SkeletonBar className="h-4 w-16" />
        <SkeletonBar className="h-3 w-24" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(4.5rem,auto)] gap-2 border-b border-border/60 bg-ivory-deep/50 px-2 py-1.5">
          <SkeletonBar className="h-2.5 w-10" />
          <SkeletonBar className="ml-auto h-2.5 w-8" />
          <SkeletonBar className="ml-auto h-2.5 w-10" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(4.5rem,auto)] items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0"
          >
            <SkeletonBar className="h-4 w-12" />
            <SkeletonBar className="h-8 w-full" />
            <SkeletonBar className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function StoneCardSkeleton() {
  return (
    <article
      className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_1px_2px_rgba(26,24,22,0.04)]"
      aria-hidden
    >
      <header className="border-b border-border/60 bg-gradient-to-r from-indigo-50/80 via-surface to-surface px-4 py-4 sm:px-5">
        <div className="space-y-2">
          <SkeletonBar className="h-6 w-40" />
          <SkeletonBar className="h-3 w-72 max-w-full" />
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-2 lg:gap-8">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <SkeletonBar className="h-3 w-20" />
                  <SkeletonBar className="h-10 w-full" />
                </div>
              ))}
            </div>
            <SkeletonBar className="h-3 w-full max-w-md" />
          </div>
          <div className="space-y-2.5 lg:border-l lg:border-border/50 lg:pl-8">
            <SkeletonBar className="h-3 w-24" />
            <div className="grid grid-cols-2 gap-2">
              <SkeletonBar className="h-[3.75rem] w-full rounded-xl" />
              <SkeletonBar className="h-[3.75rem] w-full rounded-xl" />
            </div>
            <SkeletonBar className="h-[4.5rem] w-full rounded-xl" />
          </div>
        </div>
      </header>

      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border/60">
        <GradeTableSkeleton rows={6} />
        <div className="border-t border-border/60 md:border-t-0">
          <GradeTableSkeleton rows={6} />
        </div>
      </div>
    </article>
  );
}

function DiamondStoneSettingsSkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading diamond pricing"
    >
      <div className="space-y-2">
        <SkeletonBar className="h-4 w-full max-w-xl" />
        <SkeletonBar className="h-4 w-3/4 max-w-lg" />
      </div>
      {STONE_TYPES.map((type) => (
        <StoneCardSkeleton key={type} />
      ))}
      <span className="sr-only">Loading diamond grades…</span>
    </div>
  );
}

export function DiamondStoneSettings({
  drafts,
  onChange,
  discounts,
  onDiscountChange,
  loading,
}: {
  drafts: Partial<Record<DiamondTypeOption, StoneProfileDraft>>;
  onChange: (stoneType: DiamondTypeOption, draft: StoneProfileDraft) => void;
  discounts: Record<DiamondTypeOption, number>;
  onDiscountChange: (stoneType: DiamondTypeOption, percent: number) => void;
  loading?: boolean;
}) {
  if (loading) {
    return <DiamondStoneSettingsSkeleton />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each stone type has its own base price, discount, and colour / clarity
        adjustments — the same idea as karat % for gold. Jewellery pricing will
        build variations from the grades you select on a design.
      </p>
      {STONE_TYPES.map((type) => {
        const draft = drafts[type];
        if (!draft) {
          return (
            <div
              key={type}
              className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground"
            >
              {stoneTypeLabel(type)} — save settings to create pricing rules.
            </div>
          );
        }
        return (
          <StoneCard
            key={type}
            draft={draft}
            onChange={(next) => onChange(type, next)}
            discountPercent={discounts[type] ?? 0}
            onDiscountChange={(n) => onDiscountChange(type, n)}
          />
        );
      })}
    </div>
  );
}

export async function loadDefaultStoneDrafts(): Promise<
  Partial<Record<DiamondTypeOption, StoneProfileDraft>>
> {
  const res = await fetch("/api/pricing-profiles", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load diamond pricing profiles");
  const list = (await res.json()) as PricingProfile[];
  const drafts: Partial<Record<DiamondTypeOption, StoneProfileDraft>> = {};
  for (const profile of list) {
    if (profile.isDefault) drafts[profile.stoneType] = profileToDraft(profile);
  }
  for (const profile of list) {
    if (!drafts[profile.stoneType]) {
      drafts[profile.stoneType] = profileToDraft(profile);
    }
  }
  return drafts;
}

export function draftsBaseline(
  drafts: Partial<Record<DiamondTypeOption, StoneProfileDraft>>,
): string {
  return JSON.stringify(drafts);
}

export function stoneDraftToPayload(
  draft: StoneProfileDraft,
): PricingProfileInput {
  return {
    name: draft.name,
    stoneType: draft.stoneType,
    basePricePerCt: draft.basePricePerCt,
    baseColorGrade: draft.baseColorGrade,
    baseClarityGrade: draft.baseClarityGrade,
    calculationMethod: draft.calculationMethod,
    colorRules: draft.colorRules.map((r) =>
      r.grade === draft.baseColorGrade
        ? { ...r, adjustmentPercent: 0 }
        : r,
    ),
    clarityRules: draft.clarityRules.map((r) =>
      r.grade === draft.baseClarityGrade
        ? { ...r, adjustmentPercent: 0 }
        : r,
    ),
    isDefault: true,
    updatedAt: draft.updatedAt,
  };
}

export function applyDraftRatesToDefaultsForm<
  T extends {
    defaultDiamondRateNatural: number;
    defaultDiamondRateLabGrown: number;
    defaultDiamondRateMoissanite: number;
    defaultDiamondRate: number;
    defaultDiamondColorGrade: string;
    defaultDiamondClarityGrade: string;
  },
>(form: T, drafts: Partial<Record<DiamondTypeOption, StoneProfileDraft>>): T {
  const natural = drafts.natural;
  const lab = drafts["lab-grown"];
  const moissanite = drafts.moissanite;
  return {
    ...form,
    defaultDiamondRateNatural:
      natural?.basePricePerCt ?? form.defaultDiamondRateNatural,
    defaultDiamondRate: natural?.basePricePerCt ?? form.defaultDiamondRate,
    defaultDiamondRateLabGrown:
      lab?.basePricePerCt ?? form.defaultDiamondRateLabGrown,
    defaultDiamondRateMoissanite:
      moissanite?.basePricePerCt ?? form.defaultDiamondRateMoissanite,
    defaultDiamondColorGrade:
      natural?.baseColorGrade ?? form.defaultDiamondColorGrade,
    defaultDiamondClarityGrade:
      natural?.baseClarityGrade ?? form.defaultDiamondClarityGrade,
  };
}
