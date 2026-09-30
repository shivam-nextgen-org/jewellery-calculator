"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Download, Pencil, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  downloadVariationPricesExcel,
  variationMatchesSearch,
} from "@/lib/excel/export-variations";
import { formatMoney } from "@/lib/fx/format-money";
import type { SupportedCurrency } from "@/lib/fx/currencies";
import { formatWeight } from "@/lib/format";
import type { PricedVariation, VariationOverrides } from "@/lib/pricing-engine";
import { cn } from "@/lib/utils";

type MoneyFmt = {
  currency: SupportedCurrency;
  rates: Partial<Record<string, number>> | null;
};

function money(
  value: number | string,
  fmt: MoneyFmt,
  options?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
) {
  return formatMoney(value, fmt.currency, fmt.rates, options);
}

function BreakdownBlock({
  variation,
  fmt,
  onClose,
}: {
  variation: PricedVariation;
  fmt: MoneyFmt;
  onClose?: () => void;
}) {
  const c = variation.calculation;
  const b = c.breakdown;

  return (
    <div className="sticky left-0 w-screen max-w-[calc(100vw-2rem)] space-y-3 bg-ivory-deep/35 px-4 py-4 text-sm sm:w-auto sm:max-w-none sm:px-6">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <p className="text-sm font-semibold tracking-tight text-charcoal">
          {variation.label} — breakdown
        </p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-ivory-deep hover:text-charcoal"
            aria-label="Hide breakdown"
          >
            <X className="h-3.5 w-3.5" />
            Hide
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-[0.06em] text-champagne">
            Gold
          </p>
          <p className="mt-1 text-muted-foreground">{b.goldFormula}</p>
          <p className="font-medium tabular-nums">
            = {money(c.goldPrice, fmt)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.06em] text-champagne">
            Diamond
          </p>
          <p className="mt-1 text-muted-foreground">{b.diamondGrossFormula}</p>
          <p className="font-medium tabular-nums">
            = {money(c.diamondGrossPrice, fmt)}
          </p>
          <p className="mt-2 text-muted-foreground">
            Discount {b.diamondDiscountPercent}%
            {c.appliedOverrides.diamondDiscountPercent && (
              <Badge className="ml-2">Override</Badge>
            )}
          </p>
          <p className="tabular-nums text-charcoal-muted">
            −{money(c.diamondDiscountAmount, fmt)}
          </p>
          <p className="mt-1 font-medium tabular-nums">
            Final {money(c.diamondFinalPrice, fmt)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.06em] text-champagne">
            Making
            {c.appliedOverrides.makingCharge && (
              <Badge className="ml-2">Override</Badge>
            )}
          </p>
          <p className="mt-1 text-muted-foreground">{b.makingFormula}</p>
          <p className="font-medium tabular-nums">
            = {money(c.makingCharge, fmt)}
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.06em] text-champagne">
            Other
            {c.appliedOverrides.otherChargesTotal && (
              <Badge className="ml-2">Override</Badge>
            )}
          </p>
          {b.otherLines.length === 0 ? (
            <p className="text-muted-foreground">None</p>
          ) : (
            b.otherLines.map((line) => (
              <p
                key={`${line.name}-${line.amount}`}
                className="text-muted-foreground"
              >
                {line.name}: {money(line.amount, fmt)}
              </p>
            ))
          )}
          <p className="font-medium tabular-nums">
            = {money(c.otherChargesTotal, fmt)}
          </p>
        </div>
      </div>
      <div className="border-t border-border pt-3">
        <p className="text-xs uppercase tracking-[0.06em] text-champagne">
          Final Price
          {c.appliedOverrides.finalPrice && (
            <Badge className="ml-2">Override</Badge>
          )}
        </p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {money(c.finalPrice, fmt)}
        </p>
      </div>
    </div>
  );
}

function OverrideEditor({
  variation,
  onApply,
  onClear,
}: {
  variation: PricedVariation;
  onApply: (overrides: VariationOverrides) => void;
  onClear: () => void;
}) {
  const c = variation.calculation;
  const [making, setMaking] = useState(c.makingCharge);
  const [discount, setDiscount] = useState(c.breakdown.diamondDiscountPercent);
  const [other, setOther] = useState(c.otherChargesTotal);
  const [finalPrice, setFinalPrice] = useState(c.finalPrice);

  return (
    <div className="sticky left-0 w-screen max-w-[calc(100vw-2rem)] space-y-3 bg-surface px-4 py-4 sm:w-auto sm:max-w-none sm:px-6">
      <p className="text-xs uppercase tracking-[0.06em] text-muted-foreground">
        Manual overrides
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Making (₹)</Label>
          <Input
            type="number"
            value={making}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => setMaking(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Discount (%)</Label>
          <Input
            type="number"
            value={discount}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Other total (₹)</Label>
          <Input
            type="number"
            value={other}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => setOther(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Final price (₹)</Label>
          <Input
            type="number"
            value={finalPrice}
            onChange={(e) => setFinalPrice(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            onApply({
              makingCharge: making,
              diamondDiscountPercent: discount,
              otherChargesTotal: other,
              finalPrice,
            })
          }
        >
          Apply overrides
        </Button>
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear overrides
        </Button>
      </div>
    </div>
  );
}

export function VariationResultsTable({
  variations,
  netWeight,
  diamondWeight,
  onOverride,
  onClearOverride,
  currency = "INR",
  rates = null,
  designNo = "variations",
  category = "",
}: {
  variations: PricedVariation[];
  netWeight: number;
  diamondWeight: number;
  onOverride: (variationId: string, overrides: VariationOverrides) => void;
  onClearOverride: (variationId: string) => void;
  currency?: SupportedCurrency;
  rates?: Partial<Record<string, number>> | null;
  designNo?: string;
  category?: string;
}) {
  const fmt: MoneyFmt = { currency, rates };
  const [search, setSearch] = useState("");
  // Start collapsed — the breakdown opens only when the user taps a row.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(
    () => variations.filter((row) => variationMatchesSearch(row, search)),
    [variations, search],
  );

  if (variations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No variations selected. Choose metal, purity, color, and diamond type
        to calculate.
      </p>
    );
  }

  // Column classes for the frozen (sticky) columns. Left group: toggle +
  // Variation. Right group: Diamond ₹, Making, Other, Final, edit. Middle
  // columns scroll horizontally between them.
  // Frozen columns use a distinct champagne tint so they stand out from the
  // scrolling (white) middle columns.
  // Frozen columns MUST be opaque so scrolling content never shows through
  // behind them (translucent tints caused text overlap at the boundary).
  // Frozen-column backgrounds (champagne tint) — applied on all screen sizes
  // so mobile and desktop look identical.
  const headBg = "z-20 bg-champagne-muted";
  const cellBg = "z-10 bg-[#f3ece0] group-hover:bg-[#ece2d0]";
  // On mobile only the Final column is frozen; the left column + Diamond ₹ /
  // Making / Other freeze from `lg` up. Final freezes on all sizes.
  const freezeLg = "lg:sticky";
  const freezeAll = "sticky";
  // Frozen on mobile, normal (scrolling) column on desktop.
  const freezeMobile = "sticky lg:static";
  // Grid lines: each cell draws only its right + bottom border so adjacent
  // cells never stack two borders on a shared edge (avoids double lines,
  // especially between the sticky/frozen columns). The outer container border
  // closes the top/left edges.
  const grid = "border-b border-r border-border/60";
  const hasSearch = search.trim().length > 0;

  function handleExport() {
    downloadVariationPricesExcel(filtered, {
      designNo,
      category,
      netWeight,
      diamondWeight,
      currency,
      rates,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search purity, color, diamond…"
            className="h-9 pl-8 pr-8"
            aria-label="Search variation prices"
          />
          {hasSearch ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-charcoal"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={variations.length === 0}
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>
      {hasSearch ? (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {variations.length} variation
          {variations.length === 1 ? "" : "s"}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.06em] text-muted-foreground">
              <th className={cn("w-8 px-2 py-3 left-0", grid, freezeAll, headBg)} />
              <th className={cn("px-3 py-3 font-medium left-8 w-[110px] min-w-[110px] lg:w-auto lg:min-w-[150px]", grid, freezeAll, headBg)}>
                Variation
              </th>
              <th className={cn("px-3 py-3 font-medium left-[142px] min-w-[100px] lg:left-auto", grid, freezeMobile, headBg, "lg:bg-transparent")}>
                Metal / Purity
              </th>
              <th className={cn("px-3 py-3 font-medium", grid)}>Color</th>
              <th className={cn("px-3 py-3 font-medium", grid)}>Diamond</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Net Wt</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Metal Rate</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Metal ₹</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Dia Wt</th>
              <th className={cn("px-3 py-3 font-medium text-right lg:right-[320px] min-w-[110px]", grid, freezeLg, headBg)}>
                Diamond ₹
              </th>
              <th className={cn("px-3 py-3 font-medium text-right lg:right-[230px] min-w-[90px]", grid, freezeLg, headBg)}>
                Making
              </th>
              <th className={cn("px-3 py-3 font-medium text-right lg:right-[150px] min-w-[80px]", grid, freezeLg, headBg)}>
                Other
              </th>
              <th className={cn("px-3 py-3 font-medium text-right right-0 min-w-[150px]", grid, freezeAll, headBg)}>
                Final
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No variations match your search.
                </td>
              </tr>
            ) : null}
            {filtered.map((row) => {
              const open = expandedId === row.id;
              const editing = editingId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="group">
                    <td className={cn("px-2 py-2 left-0", grid, freezeAll, cellBg)}>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center text-muted-foreground"
                        onClick={() =>
                          setExpandedId((id) =>
                            id === row.id ? null : row.id,
                          )
                        }
                        aria-expanded={open}
                        aria-label={`Toggle breakdown for ${row.label}`}
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            open && "rotate-180",
                          )}
                        />
                      </button>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 font-medium left-8 w-[110px] min-w-[110px] lg:w-auto lg:min-w-[150px]",
                        grid,
                        freezeAll,
                        cellBg,
                      )}
                    >
                      <button
                        type="button"
                        className="text-left"
                        onClick={() =>
                          setExpandedId((id) =>
                            id === row.id ? null : row.id,
                          )
                        }
                      >
                        <span className="block lg:whitespace-nowrap">
                          {row.label}
                        </span>
                        {row.hasManualOverride && (
                          <Badge className="mt-1 lg:ml-2 lg:mt-0">Manual</Badge>
                        )}
                      </button>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-3 text-muted-foreground left-[142px] min-w-[100px] z-10 bg-[#f3ece0] lg:left-auto lg:z-auto lg:bg-transparent lg:group-hover:bg-ivory-deep/25",
                        grid,
                        freezeMobile,
                      )}
                    >
                      {row.metalLabel} · {row.purity}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 group-hover:bg-ivory-deep/25", grid)}>
                      {row.colorLabel.replace(" Gold", "")}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-muted-foreground group-hover:bg-ivory-deep/25", grid)}>
                      {row.diamondTypeLabel}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground group-hover:bg-ivory-deep/25", grid)}>
                      {formatWeight(netWeight)}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums group-hover:bg-ivory-deep/25", grid)}>
                      {money(row.goldRatePerGram, fmt, {
                        maximumFractionDigits: 0,
                        minimumFractionDigits: 0,
                      })}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums group-hover:bg-ivory-deep/25", grid)}>
                      {money(row.calculation.goldPrice, fmt)}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground group-hover:bg-ivory-deep/25", grid)}>
                      {formatWeight(diamondWeight, "CT")}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums whitespace-nowrap lg:right-[320px] min-w-[110px]",
                        grid,
                        freezeLg,
                        cellBg,
                      )}
                    >
                      {money(row.calculation.diamondFinalPrice, fmt)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums whitespace-nowrap lg:right-[230px] min-w-[90px]",
                        grid,
                        freezeLg,
                        cellBg,
                      )}
                    >
                      {money(row.calculation.makingCharge, fmt)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums whitespace-nowrap lg:right-[150px] min-w-[80px]",
                        grid,
                        freezeLg,
                        cellBg,
                      )}
                    >
                      {money(row.calculation.otherChargesTotal, fmt)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 right-0 min-w-[150px]",
                        grid,
                        freezeAll,
                        cellBg,
                      )}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular-nums font-medium">
                          {money(row.calculation.finalPrice, fmt)}
                        </span>
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-charcoal"
                          onClick={() =>
                            setEditingId((id) =>
                              id === row.id ? null : row.id,
                            )
                          }
                          aria-label={`Edit overrides for ${row.label}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {(open || editing) && (
                    <tr className="border-b border-border/70">
                      <td colSpan={13} className="p-0">
                        {open && (
                          <BreakdownBlock
                            variation={row}
                            fmt={fmt}
                            onClose={() => setExpandedId(null)}
                          />
                        )}
                        {editing && (
                          <OverrideEditor
                            key={`${row.id}-${row.calculation.finalPrice}`}
                            variation={row}
                            onApply={(overrides) => {
                              onOverride(row.id, overrides);
                              setEditingId(null);
                              setExpandedId(row.id);
                            }}
                            onClear={() => {
                              onClearOverride(row.id);
                              setEditingId(null);
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
