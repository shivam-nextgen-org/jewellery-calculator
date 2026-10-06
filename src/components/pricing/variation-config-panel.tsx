"use client";

import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { stoneTypeLabel, type VariationBreakdown } from "@/lib/pricing-engine";
import {
  METAL_OPTIONS,
  STONE_TYPE_OPTIONS,
  colorOptionsForMetal,
  defaultMetalSelection,
  gradeOptionsForStoneType,
  purityOptionsForMetal,
  stoneGradesForType,
  toggleInArray,
  type StoneGradeSourceMap,
} from "@/lib/variation-selection";
import { cn } from "@/lib/utils";
import type {
  DiamondTypeOption,
  GoldColorOption,
  GoldMetalOption,
  VariationSelection,
} from "@/types/jewellery";

const STONE_HINT: Record<DiamondTypeOption, string> = {
  natural: "GIA colour D–M with FL–I3 clarity.",
  "lab-grown": "Same GIA grades, priced off the lab-grown base.",
  moissanite: "Commercial bands — never GIA grades.",
};

/** A single tappable option chip. */
function SelectChip({
  checked,
  onToggle,
  size = "md",
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  size?: "md" | "sm";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 rounded-xl border text-left font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/40",
        size === "md"
          ? "gap-2.5 px-3.5 py-3 text-[15px]"
          : "px-2.5 py-2 text-[13px]",
        checked
          ? "border-champagne bg-champagne-muted/40 text-charcoal shadow-sm"
          : "border-border bg-surface text-charcoal-muted hover:border-champagne/40 hover:bg-ivory-deep/50",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border transition-colors",
          size === "md" ? "h-5 w-5" : "h-4 w-4",
          checked
            ? "border-champagne bg-champagne text-charcoal"
            : "border-border bg-surface",
        )}
        aria-hidden
      >
        {checked ? (
          <Check className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={3} />
        ) : null}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** A titled section block for the Variation Configuration panel. */
function ConfigSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-champagne" aria-hidden />
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-charcoal">
          {title}
        </h3>
      </div>
      {hint ? (
        <p className="-mt-1 text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A parent option (a metal or a stone type) with its own nested chips. Nested
 * options only render while the parent is selected, so the panel reads the way
 * the trade does: pick Gold, then its karats and colours.
 */
function GroupCard({
  title,
  hint,
  selected,
  onToggle,
  summary,
  warning,
  children,
}: {
  title: string;
  hint: string;
  selected: boolean;
  onToggle: () => void;
  summary?: string;
  warning?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors",
        selected
          ? "border-champagne/70 bg-surface shadow-sm"
          : "border-border/80 bg-surface/50",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-champagne/40"
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            selected
              ? "border-champagne bg-champagne text-charcoal"
              : "border-border bg-surface",
          )}
          aria-hidden
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-charcoal">
            {title}
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {hint}
          </span>
        </span>
        {selected && summary ? (
          <span className="shrink-0 rounded-full border border-border bg-ivory-deep/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-charcoal-muted">
            {summary}
          </span>
        ) : null}
      </button>
      {selected ? (
        <div className="space-y-3.5 border-t border-border/70 bg-ivory-deep/30 px-3.5 py-3.5">
          {warning ? (
            <p className="text-[12px] font-medium text-destructive">{warning}</p>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** One nested axis of chips (purity, metal colour, stone colour, clarity). */
function ChipRow({
  label,
  options,
  selectedCount,
  onSelectAll,
  onClear,
  emptyHint,
  children,
}: {
  label: string;
  options: readonly string[];
  selectedCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  emptyHint?: string;
  children: React.ReactNode;
}) {
  const longest = options.reduce((max, o) => Math.max(max, o.length), 0);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-charcoal-muted">
          {label}
        </span>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="tabular-nums text-muted-foreground">
            {selectedCount}/{options.length}
          </span>
          <button
            type="button"
            onClick={onSelectAll}
            className="font-medium text-charcoal-muted underline-offset-2 hover:text-charcoal hover:underline"
          >
            All
          </button>
          <button
            type="button"
            onClick={onClear}
            className="font-medium text-charcoal-muted underline-offset-2 hover:text-charcoal hover:underline"
          >
            Clear
          </button>
        </span>
      </div>
      <div
        className={cn(
          "grid gap-2",
          longest > 8
            ? "grid-cols-2"
            : longest > 4
              ? "grid-cols-3"
              : "grid-cols-3 sm:grid-cols-4",
        )}
      >
        {children}
      </div>
      {selectedCount === 0 && emptyHint ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">{emptyHint}</p>
      ) : null}
    </div>
  );
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function VariationConfigPanel({
  selection,
  onSelectionChange,
  gradeSources,
  breakdown,
}: {
  selection: VariationSelection;
  onSelectionChange: (
    update: (prev: VariationSelection) => VariationSelection,
  ) => void;
  /** Settings profiles per stone type — drive the grade chips shown. */
  gradeSources: StoneGradeSourceMap;
  breakdown: VariationBreakdown;
}) {
  function toggleMetal(metal: GoldMetalOption) {
    onSelectionChange((prev) => {
      const turningOn = !prev.metals.includes(metal);
      const next: VariationSelection = {
        ...prev,
        metals: toggleInArray(prev.metals, metal),
      };
      if (!turningOn) return next;

      // Seed the usual purities / colours the first time a metal comes on;
      // a returning metal keeps whatever the user had picked before.
      const purities = purityOptionsForMetal(metal);
      const colors = colorOptionsForMetal(metal).map((c) => c.id);
      const seeded = defaultMetalSelection(metal);
      if (!prev.purities.some((p) => purities.includes(p))) {
        next.purities = [...next.purities, ...seeded.purities];
      }
      if (!prev.colors.some((c) => colors.includes(c))) {
        next.colors = [...next.colors, ...seeded.colors];
      }
      return next;
    });
  }

  function toggleStoneType(stoneType: DiamondTypeOption) {
    onSelectionChange((prev) => {
      const turningOn = !prev.diamondTypes.includes(stoneType);
      const next: VariationSelection = {
        ...prev,
        diamondTypes: toggleInArray(prev.diamondTypes, stoneType),
      };
      if (turningOn && !prev.stoneGrades?.[stoneType]) {
        next.stoneGrades = {
          ...prev.stoneGrades,
          [stoneType]: stoneGradesForType(
            prev.stoneGrades,
            stoneType,
            gradeSources,
          ),
        };
      }
      return next;
    });
  }

  function setStoneGrades(
    stoneType: DiamondTypeOption,
    axis: "colors" | "clarities",
    update: (current: string[]) => string[],
  ) {
    onSelectionChange((prev) => {
      const current = prev.stoneGrades?.[stoneType] ?? {
        colors: [],
        clarities: [],
      };
      return {
        ...prev,
        stoneGrades: {
          ...prev.stoneGrades,
          [stoneType]: { ...current, [axis]: update(current[axis]) },
        },
      };
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-charcoal">
            Variation Configuration
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Pick a metal, then its purities and colours — then each stone with
            its own grades.
          </p>
        </div>
        <Badge className="shrink-0 border-charcoal bg-charcoal text-ivory">
          {plural(breakdown.total, "variation")}
        </Badge>
      </div>

      <ConfigSection
        title="Metal"
        hint="Gold karats pair with yellow / white / rose; silver purities with sterling."
      >
        <div className="space-y-2.5">
          {METAL_OPTIONS.map((metal) => {
            const purities = purityOptionsForMetal(metal.id);
            const colors = colorOptionsForMetal(metal.id);
            const selectedPurities = purities.filter((p) =>
              selection.purities.includes(p),
            );
            const selectedColors = colors.filter((c) =>
              selection.colors.includes(c.id),
            );
            const combos = selectedPurities.length * selectedColors.length;
            const isOn = selection.metals.includes(metal.id);
            return (
              <GroupCard
                key={metal.id}
                title={metal.label}
                hint={
                  metal.id === "silver"
                    ? "Priced off the 999 silver rate."
                    : "Priced off the 24K gold rate."
                }
                selected={isOn}
                onToggle={() => toggleMetal(metal.id)}
                summary={plural(combos, "combo")}
                warning={
                  isOn && combos === 0
                    ? "Pick at least one purity and one colour."
                    : null
                }
              >
                <ChipRow
                  label="Purity"
                  options={purities}
                  selectedCount={selectedPurities.length}
                  onSelectAll={() =>
                    onSelectionChange((prev) => ({
                      ...prev,
                      purities: Array.from(
                        new Set([...prev.purities, ...purities]),
                      ),
                    }))
                  }
                  onClear={() =>
                    onSelectionChange((prev) => ({
                      ...prev,
                      purities: prev.purities.filter(
                        (p) => !purities.includes(p),
                      ),
                    }))
                  }
                >
                  {purities.map((purity) => (
                    <SelectChip
                      key={purity}
                      size="sm"
                      checked={selection.purities.includes(purity)}
                      onToggle={() =>
                        onSelectionChange((prev) => ({
                          ...prev,
                          purities: toggleInArray(prev.purities, purity),
                        }))
                      }
                    >
                      {purity}
                    </SelectChip>
                  ))}
                </ChipRow>

                <ChipRow
                  label="Colour"
                  options={colors.map((c) => c.label)}
                  selectedCount={selectedColors.length}
                  onSelectAll={() =>
                    onSelectionChange((prev) => ({
                      ...prev,
                      colors: Array.from(
                        new Set<GoldColorOption>([
                          ...prev.colors,
                          ...colors.map((c) => c.id),
                        ]),
                      ),
                    }))
                  }
                  onClear={() =>
                    onSelectionChange((prev) => ({
                      ...prev,
                      colors: prev.colors.filter(
                        (c) => !colors.some((opt) => opt.id === c),
                      ),
                    }))
                  }
                >
                  {colors.map((color) => (
                    <SelectChip
                      key={color.id}
                      size="sm"
                      checked={selection.colors.includes(color.id)}
                      onToggle={() =>
                        onSelectionChange((prev) => ({
                          ...prev,
                          colors: toggleInArray(prev.colors, color.id),
                        }))
                      }
                    >
                      {color.label}
                    </SelectChip>
                  ))}
                </ChipRow>
              </GroupCard>
            );
          })}
        </div>
      </ConfigSection>

      <ConfigSection
        title="Stone"
        hint="Grades picked under a stone only build rows for that stone."
      >
        <div className="space-y-2.5">
          {STONE_TYPE_OPTIONS.map((stoneType) => {
            const isOn = selection.diamondTypes.includes(stoneType);
            const options = gradeOptionsForStoneType(
              stoneType,
              gradeSources[stoneType],
            );
            const grades = selection.stoneGrades?.[stoneType] ?? {
              colors: [],
              clarities: [],
            };
            const rows = breakdown.rowsByStoneType[stoneType] ?? 0;
            return (
              <GroupCard
                key={stoneType}
                title={stoneTypeLabel(stoneType)}
                hint={STONE_HINT[stoneType]}
                selected={isOn}
                onToggle={() => toggleStoneType(stoneType)}
                summary={`${plural(rows, "row")} / combo`}
              >
                <ChipRow
                  label={stoneType === "moissanite" ? "Colour band" : "Colour"}
                  options={options.colors}
                  selectedCount={grades.colors.length}
                  emptyHint="No colour split — one row at the base grade."
                  onSelectAll={() =>
                    setStoneGrades(stoneType, "colors", () => [
                      ...options.colors,
                    ])
                  }
                  onClear={() => setStoneGrades(stoneType, "colors", () => [])}
                >
                  {options.colors.map((grade) => (
                    <SelectChip
                      key={grade}
                      size="sm"
                      checked={grades.colors.includes(grade)}
                      onToggle={() =>
                        setStoneGrades(stoneType, "colors", (current) =>
                          toggleInArray(current, grade),
                        )
                      }
                    >
                      {grade}
                    </SelectChip>
                  ))}
                </ChipRow>

                <ChipRow
                  label={stoneType === "moissanite" ? "Clarity band" : "Clarity"}
                  options={options.clarities}
                  selectedCount={grades.clarities.length}
                  emptyHint="No clarity split — one row at the base grade."
                  onSelectAll={() =>
                    setStoneGrades(stoneType, "clarities", () => [
                      ...options.clarities,
                    ])
                  }
                  onClear={() =>
                    setStoneGrades(stoneType, "clarities", () => [])
                  }
                >
                  {options.clarities.map((grade) => (
                    <SelectChip
                      key={grade}
                      size="sm"
                      checked={grades.clarities.includes(grade)}
                      onToggle={() =>
                        setStoneGrades(stoneType, "clarities", (current) =>
                          toggleInArray(current, grade),
                        )
                      }
                    >
                      {grade}
                    </SelectChip>
                  ))}
                </ChipRow>
              </GroupCard>
            );
          })}
        </div>
      </ConfigSection>

      <div className="rounded-xl border border-border/70 bg-surface px-3.5 py-3 text-[13px] text-charcoal-muted">
        <p className="tabular-nums">
          <span className="font-semibold text-charcoal">
            {plural(breakdown.metalCombinations, "metal combo")}
          </span>{" "}
          ×{" "}
          <span className="font-semibold text-charcoal">
            {plural(breakdown.stoneRows, "stone row")}
          </span>{" "}
          ={" "}
          <span className="font-semibold text-charcoal">
            {plural(breakdown.total, "variation")}
          </span>
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Stone rows are added per stone type, so Moissanite bands never price a
          Natural or Lab Grown row.
        </p>
      </div>
    </div>
  );
}
