"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR, formatWeight } from "@/lib/format";
import type { PricedVariation, VariationOverrides } from "@/lib/pricing-engine";
import { cn } from "@/lib/utils";

function BreakdownBlock({ variation }: { variation: PricedVariation }) {
  const c = variation.calculation;
  const b = c.breakdown;

  return (
    <div className="space-y-3 bg-ivory-deep/35 px-4 py-4 text-sm sm:px-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-[0.06em] text-champagne">
            Gold
          </p>
          <p className="mt-1 text-muted-foreground">{b.goldFormula}</p>
          <p className="font-medium tabular-nums">= {formatINR(c.goldPrice)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.06em] text-champagne">
            Diamond
          </p>
          <p className="mt-1 text-muted-foreground">{b.diamondGrossFormula}</p>
          <p className="font-medium tabular-nums">
            = {formatINR(c.diamondGrossPrice)}
          </p>
          <p className="mt-2 text-muted-foreground">
            Discount {b.diamondDiscountPercent}%
            {c.appliedOverrides.diamondDiscountPercent && (
              <Badge className="ml-2">Override</Badge>
            )}
          </p>
          <p className="tabular-nums text-charcoal-muted">
            −{formatINR(c.diamondDiscountAmount)}
          </p>
          <p className="mt-1 font-medium tabular-nums">
            Final {formatINR(c.diamondFinalPrice)}
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
            = {formatINR(c.makingCharge)}
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
              <p key={`${line.name}-${line.amount}`} className="text-muted-foreground">
                {line.name}: {formatINR(line.amount)}
              </p>
            ))
          )}
          <p className="font-medium tabular-nums">
            = {formatINR(c.otherChargesTotal)}
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
          {formatINR(c.finalPrice)}
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
    <div className="space-y-3 bg-surface px-4 py-4 sm:px-6">
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
}: {
  variations: PricedVariation[];
  netWeight: number;
  diamondWeight: number;
  onOverride: (variationId: string, overrides: VariationOverrides) => void;
  onClearOverride: (variationId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(
    variations[0]?.id ?? null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);

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
  const stickyHead = "sticky z-20 bg-champagne-muted/60";
  const stickyCell =
    "sticky z-10 bg-champagne-muted/25 group-hover:bg-champagne-muted/45";
  // Grid lines: each cell draws only its right + bottom border so adjacent
  // cells never stack two borders on a shared edge (avoids double lines,
  // especially between the sticky/frozen columns). The outer container border
  // closes the top/left edges.
  const grid = "border-b border-r border-border/60";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.06em] text-muted-foreground">
              <th className={cn("w-8 px-2 py-3 left-0", grid, stickyHead)} />
              <th className={cn("px-3 py-3 font-medium left-8 min-w-[150px]", grid, stickyHead)}>
                Variation
              </th>
              <th className={cn("px-3 py-3 font-medium", grid)}>Metal / Purity</th>
              <th className={cn("px-3 py-3 font-medium", grid)}>Color</th>
              <th className={cn("px-3 py-3 font-medium", grid)}>Diamond</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Net Wt</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Gold Rate</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Gold ₹</th>
              <th className={cn("px-3 py-3 font-medium text-right", grid)}>Dia Wt</th>
              <th className={cn("px-3 py-3 font-medium text-right right-[320px] min-w-[110px]", grid, stickyHead)}>
                Diamond ₹
              </th>
              <th className={cn("px-3 py-3 font-medium text-right right-[230px] min-w-[90px]", grid, stickyHead)}>
                Making
              </th>
              <th className={cn("px-3 py-3 font-medium text-right right-[150px] min-w-[80px]", grid, stickyHead)}>
                Other
              </th>
              <th className={cn("px-3 py-3 font-medium text-right right-0 min-w-[150px]", grid, stickyHead)}>
                Final
              </th>
            </tr>
          </thead>
          <tbody>
            {variations.map((row) => {
              const open = expandedId === row.id;
              const editing = editingId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="group">
                    <td className={cn("px-2 py-2 left-0", grid, stickyCell)}>
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
                        "px-3 py-3 font-medium left-8",
                        grid,
                        stickyCell,
                      )}
                    >
                      <button
                        type="button"
                        className="whitespace-nowrap text-left"
                        onClick={() =>
                          setExpandedId((id) =>
                            id === row.id ? null : row.id,
                          )
                        }
                      >
                        {row.label}
                        {row.hasManualOverride && (
                          <Badge className="ml-2">Manual</Badge>
                        )}
                      </button>
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-muted-foreground group-hover:bg-ivory-deep/25", grid)}>
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
                      {formatINR(row.goldRatePerGram, {
                        maximumFractionDigits: 0,
                        minimumFractionDigits: 0,
                      })}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums group-hover:bg-ivory-deep/25", grid)}>
                      {formatINR(row.calculation.goldPrice)}
                    </td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground group-hover:bg-ivory-deep/25", grid)}>
                      {formatWeight(diamondWeight, "CT")}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums whitespace-nowrap right-[320px] min-w-[110px]",
                        grid,
                        stickyCell,
                      )}
                    >
                      {formatINR(row.calculation.diamondFinalPrice)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums whitespace-nowrap right-[230px] min-w-[90px]",
                        grid,
                        stickyCell,
                      )}
                    >
                      {formatINR(row.calculation.makingCharge)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right tabular-nums whitespace-nowrap right-[150px] min-w-[80px]",
                        grid,
                        stickyCell,
                      )}
                    >
                      {formatINR(row.calculation.otherChargesTotal)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 right-0 min-w-[150px]",
                        grid,
                        stickyCell,
                      )}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular-nums font-medium">
                          {formatINR(row.calculation.finalPrice)}
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
                        {open && <BreakdownBlock variation={row} />}
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
  );
}
