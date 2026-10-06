"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Coins,
  Gem,
  Globe2,
  Hammer,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  applyDraftRatesToDefaultsForm,
  DiamondStoneSettings,
  draftsBaseline,
  loadDefaultStoneDrafts,
  stoneDraftToPayload,
  type StoneProfileDraft,
  STONE_TYPES,
} from "@/components/settings/diamond-stone-settings";
import { formatINR } from "@/lib/format";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import { cn } from "@/lib/utils";
import type {
  ChargeCalcType,
  DiamondTypeOption,
  GoldPurityOption,
  PricingDefaults,
} from "@/types/jewellery";

const GOLD_PURITIES: GoldPurityOption[] = ["24K", "22K", "18K", "14K", "10K", "9K"];
const SILVER_PURITIES: GoldPurityOption[] = ["999", "958", "925"];

const DISCOUNT_KEY_BY_STONE: Record<
  DiamondTypeOption,
  | "defaultDiamondDiscountNatural"
  | "defaultDiamondDiscountLabGrown"
  | "defaultDiamondDiscountMoissanite"
> = {
  natural: "defaultDiamondDiscountNatural",
  "lab-grown": "defaultDiamondDiscountLabGrown",
  moissanite: "defaultDiamondDiscountMoissanite",
};

const CALC_TYPES: { value: ChargeCalcType; label: string }[] = [
  { value: "per-gram", label: "Per gram" },
  { value: "fixed", label: "Fixed" },
  { value: "percentage", label: "Percentage" },
];

function formatIst(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

const perGram = (base: number, percent: number) =>
  formatINR(Math.round((base * (percent || 0)) / 100), { maximumFractionDigits: 0 });

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

type Tone = "gold" | "silver" | "diamond" | "charges";

const TONE_STRIP: Record<Tone, string> = {
  gold: "from-champagne-soft via-champagne to-amber-300",
  silver: "from-slate-200 via-slate-300 to-slate-200",
  diamond: "from-sky-200 via-indigo-200 to-violet-200",
  charges: "from-champagne-muted via-champagne-soft to-champagne-muted",
};

const TONE_ICON: Record<Tone, string> = {
  gold: "bg-champagne-muted/70 text-charcoal",
  silver: "bg-slate-100 text-slate-600",
  diamond: "bg-indigo-50 text-indigo-500",
  charges: "bg-ivory-deep text-charcoal-muted",
};

function Section({
  tone,
  icon: Icon,
  title,
  description,
  meta,
  className,
  children,
}: {
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  meta?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const id = `settings-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_1px_2px_rgba(26,24,22,0.04)]",
        className,
      )}
    >
      <div className={cn("h-1 bg-gradient-to-r", TONE_STRIP[tone])} aria-hidden="true" />
      <header className="flex items-center gap-3 px-5 pb-4 pt-5 sm:px-6">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", TONE_ICON[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 id={id} className="truncate font-display text-xl font-semibold leading-tight tracking-tight text-charcoal">
              {title}
            </h2>
            {meta ? <div className="shrink-0">{meta}</div> : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground" title={description}>
            {description}
          </p>
        </div>
      </header>
      <div className="flex-1 px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
    </section>
  );
}

/** Small "auto-updated" chip shown in a section header. */
function SyncChip({ when, schedule }: { when: string | null; schedule: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border/80 bg-ivory-deep/60 px-2.5 py-1 text-[11px] font-medium text-charcoal-muted"
      title={`Refreshed automatically every day at ${schedule} IST`}
    >
      <Clock className="h-3 w-3 text-champagne" aria-hidden="true" />
      {when ? `Updated ${when}` : `Auto-updates ${schedule}`}
    </span>
  );
}

/** Number field with an optional prefix (₹) and unit suffix (/ g, %). */
function AffixField({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  step,
  disabled,
  size = "md",
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: string;
  disabled?: boolean;
  size?: "md" | "lg";
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-charcoal-muted">
        {label}
      </label>
      <div className="relative">
        {prefix ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground",
              size === "lg" ? "left-4 text-lg font-medium" : "text-sm",
            )}
          >
            {prefix}
          </span>
        ) : null}
        <NumberInput
          id={id}
          step={step}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          className={cn(
            "tabular-nums",
            // Hide native spinners so every price box looks identical.
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            prefix && "pl-7",
            suffix && "pr-14",
            size === "lg" && "h-12 pl-9 pr-20 font-display text-xl font-medium",
          )}
        />
        {suffix ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-y-0 right-3 flex items-center font-medium text-muted-foreground",
              size === "lg"
                ? "right-2 my-2 rounded-md border-l border-border/70 pl-3 pr-2 text-xs"
                : "text-xs",
            )}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** One purity: % input plus the resulting rate per gram. */
function PurityTile({
  purity,
  label,
  percent,
  base,
  onChange,
}: {
  purity: GoldPurityOption;
  label?: string;
  percent: number;
  base: number;
  onChange: (value: number) => void;
}) {
  const id = `purity-${purity}`;
  return (
    <div className="rounded-xl border border-border/70 bg-surface-elevated p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-charcoal">
          {label ?? purity}
        </label>
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {perGram(base, percent)}/g
        </span>
      </div>
      <div className="relative">
        <NumberInput
          id={id}
          step="0.01"
          value={percent}
          onValueChange={onChange}
          aria-label={`${label ?? purity} purity percent`}
          className="h-9 pr-8 tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

/** Charge amount whose unit follows the selected calculation type. */
function ChargeField({
  id,
  label,
  amount,
  type,
  onAmount,
  onType,
}: {
  id: string;
  label: string;
  amount: number;
  type: ChargeCalcType;
  onAmount: (value: number) => void;
  onType: (value: ChargeCalcType) => void;
}) {
  const suffix = type === "percentage" ? "%" : type === "per-gram" ? "₹ / g" : "₹";
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[13px] font-medium text-charcoal-muted">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="relative">
          <NumberInput
            id={id}
            value={amount}
            onValueChange={onAmount}
            aria-label={`${label} amount`}
            className="pr-14 tabular-nums"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
            {suffix}
          </span>
        </div>
        <select
          aria-label={`${label} calculation`}
          className="app-select h-10 rounded-md border border-input bg-surface-elevated pl-3 text-sm text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/40"
          value={type}
          onChange={(e) => onType(e.target.value as ChargeCalcType)}
        >
          {CALC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export function PricingDefaultsForm({
  initialDefaults,
}: {
  initialDefaults: PricingDefaults;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PricingDefaults>(initialDefaults);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialDefaults));
  const [stoneDrafts, setStoneDrafts] = useState<
    Partial<Record<DiamondTypeOption, StoneProfileDraft>>
  >({});
  const [stoneBaseline, setStoneBaseline] = useState("");
  const [stonesLoading, setStonesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fxLastUpdated, setFxLastUpdated] = useState<string | null>(null);

  const formDirty = useMemo(
    () => JSON.stringify(form) !== baseline,
    [form, baseline],
  );
  const stonesDirty = useMemo(
    () => draftsBaseline(stoneDrafts) !== stoneBaseline,
    [stoneDrafts, stoneBaseline],
  );
  const dirty = formDirty || stonesDirty;

  const update = useCallback(<K extends keyof PricingDefaults>(key: K, value: PricingDefaults[K]) => {
    setForm((d) => ({ ...d, [key]: value }));
    setJustSaved(false);
  }, []);

  const setPurity = useCallback((purity: GoldPurityOption, value: number) => {
    setForm((d) => ({ ...d, purityPercentages: { ...d.purityPercentages, [purity]: value } }));
    setJustSaved(false);
  }, []);

  const updateStoneDraft = useCallback(
    (stoneType: DiamondTypeOption, draft: StoneProfileDraft) => {
      setStoneDrafts((prev) => {
        const next = { ...prev, [stoneType]: draft };
        setForm((formPrev) => applyDraftRatesToDefaultsForm(formPrev, next));
        return next;
      });
      setJustSaved(false);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const drafts = await loadDefaultStoneDrafts();
        if (cancelled) return;
        setStoneDrafts(drafts);
        setStoneBaseline(draftsBaseline(drafts));
        setForm((prev) => applyDraftRatesToDefaultsForm(prev, drafts));
      } catch {
        // Profiles may not exist yet — form rates still work.
      } finally {
        if (!cancelled) setStonesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/fx-rates/current");
        if (!res.ok) return;
        const body = (await res.json()) as { capturedAt?: string | null };
        if (!cancelled) setFxLastUpdated(formatIst(body.capturedAt));
      } catch {
        // Informational only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const formPayload = applyDraftRatesToDefaultsForm(form, stoneDrafts);
      const res = await fetch("/api/settings/pricing-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPayload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't save your settings. Please try again.");
      }
      const savedBody = (await res.json()) as PricingDefaults;

      // Persist per-stone color/clarity % rules and calculation method.
      for (const stoneType of STONE_TYPES) {
        const draft = stoneDrafts[stoneType];
        if (!draft?.id) continue;
        const profileRes = await fetch(`/api/pricing-profiles/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stoneDraftToPayload(draft)),
        });
        if (!profileRes.ok) {
          const body = (await profileRes.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            body?.error ??
              `Couldn't save ${stoneType} diamond color/clarity rules.`,
          );
        }
        const savedProfile = (await profileRes.json()) as {
          id: string;
          updatedAt: string;
          basePricePerCt: number;
          baseColorGrade: string;
          baseClarityGrade: string;
          calculationMethod: StoneProfileDraft["calculationMethod"];
          colorRules: StoneProfileDraft["colorRules"];
          clarityRules: StoneProfileDraft["clarityRules"];
          name: string;
          stoneType: DiamondTypeOption;
        };
        setStoneDrafts((prev) => ({
          ...prev,
          [stoneType]: {
            id: savedProfile.id,
            updatedAt: savedProfile.updatedAt,
            name: savedProfile.name,
            stoneType: savedProfile.stoneType,
            basePricePerCt: savedProfile.basePricePerCt,
            baseColorGrade: savedProfile.baseColorGrade,
            baseClarityGrade: savedProfile.baseClarityGrade,
            calculationMethod: savedProfile.calculationMethod,
            colorRules: savedProfile.colorRules,
            clarityRules: savedProfile.clarityRules,
          },
        }));
      }

      const refreshedDrafts = await loadDefaultStoneDrafts();
      setStoneDrafts(refreshedDrafts);
      setStoneBaseline(draftsBaseline(refreshedDrafts));
      const nextForm = applyDraftRatesToDefaultsForm(savedBody, refreshedDrafts);
      setForm(nextForm);
      setBaseline(JSON.stringify(nextForm));
      setJustSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your settings.");
    } finally {
      setSaving(false);
    }
  }, [form, saving, router, stoneDrafts]);

  function discard() {
    const previous = JSON.parse(baseline) as PricingDefaults;
    setForm(previous);
    if (stoneBaseline) {
      setStoneDrafts(JSON.parse(stoneBaseline) as Partial<
        Record<DiamondTypeOption, StoneProfileDraft>
      >);
    }
    setError(null);
  }

  /** Restores app defaults for everything except today's market rates. Not saved until "Save". */
  function restoreDefaults() {
    setForm((d) => ({
      ...MOCK_PRICING_DEFAULTS,
      gold24kRate: d.gold24kRate,
      silverRate: d.silverRate,
      goldRateLastUpdatedAt: d.goldRateLastUpdatedAt,
      silverRateLastUpdatedAt: d.silverRateLastUpdatedAt,
    }));
    setJustSaved(false);
  }

  // Ctrl/⌘ + S saves; warn before leaving with unsaved changes.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, save]);

  const pct = form.purityPercentages;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Gold */}
        <Section
          tone="gold"
          icon={Coins}
          title="Gold"
          description="24K base rate and karat purities."
          meta={<SyncChip when={formatIst(form.goldRateLastUpdatedAt)} schedule="11:15 AM" />}
          className="lg:col-span-7"
        >
          <div className="space-y-4">
            <AffixField
              id="gold-rate"
              label="24K gold rate"
              prefix="₹"
              suffix="/ gram"
              size="lg"
              value={form.gold24kRate}
              onChange={(n) => update("gold24kRate", n)}
            />
            <div>
              <p className="mb-2 text-[13px] font-medium text-charcoal-muted">Purity and rate per gram</p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {GOLD_PURITIES.map((p) => (
                  <PurityTile
                    key={p}
                    purity={p}
                    percent={pct[p]}
                    base={form.gold24kRate}
                    onChange={(n) => setPurity(p, n)}
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Silver */}
        <Section
          tone="silver"
          icon={Coins}
          title="Silver"
          description="999 base rate (IBJA benchmark) and silver grades."
          meta={<SyncChip when={formatIst(form.silverRateLastUpdatedAt)} schedule="11:16 AM" />}
          className="lg:col-span-5"
        >
          <div className="space-y-4">
            <AffixField
              id="silver-rate"
              label="999 silver rate"
              prefix="₹"
              suffix="/ gram"
              size="lg"
              value={form.silverRate}
              onChange={(n) => update("silverRate", n)}
            />
            <div>
              <p className="mb-2 text-[13px] font-medium text-charcoal-muted">Purity and rate per gram</p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {SILVER_PURITIES.map((p) => (
                  <PurityTile
                    key={p}
                    purity={p}
                    label={p === "925" ? "925 Sterling" : p}
                    percent={pct[p]}
                    base={form.silverRate}
                    onChange={(n) => setPurity(p, n)}
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Diamonds — same mental model as gold/silver: base + % adjustments */}
        <Section
          tone="diamond"
          icon={Gem}
          title="Diamonds & stones"
          description="Base ₹/ct for each stone type, then +/- % by color and clarity — like karat purity for gold."
          className="lg:col-span-12"
        >
          <div className="space-y-4">
            <DiamondStoneSettings
              drafts={stoneDrafts}
              onChange={updateStoneDraft}
              loading={stonesLoading}
              discounts={{
                natural: form.defaultDiamondDiscountNatural,
                "lab-grown": form.defaultDiamondDiscountLabGrown,
                moissanite: form.defaultDiamondDiscountMoissanite,
              }}
              onDiscountChange={(stoneType, percent) => {
                const key = DISCOUNT_KEY_BY_STONE[stoneType];
                setForm((d) => ({
                  ...d,
                  [key]: percent,
                  ...(stoneType === "natural"
                    ? { defaultDiamondDiscount: percent }
                    : {}),
                }));
                setJustSaved(false);
              }}
            />
          </div>
        </Section>

        {/* Charges */}
        <Section
          tone="charges"
          icon={Hammer}
          title="Charges"
          description="Added to every variation's price."
          className="lg:col-span-12 lg:max-w-xl"
        >
          <div className="space-y-4">
            <ChargeField
              id="making-charge"
              label="Making charge"
              amount={form.defaultMakingCharge}
              type={form.defaultMakingCalcType}
              onAmount={(n) => update("defaultMakingCharge", n)}
              onType={(t) => update("defaultMakingCalcType", t)}
            />
            <ChargeField
              id="other-charge"
              label="Other charge"
              amount={form.defaultOtherCharge}
              type={form.defaultOtherCalcType}
              onAmount={(n) => update("defaultOtherCharge", n)}
              onType={(t) => update("defaultOtherCalcType", t)}
            />
          </div>
        </Section>
      </div>

      {/* Currency (informational) */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-surface-elevated px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ivory-deep text-charcoal-muted">
            <Globe2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-charcoal">Currency rates</p>
            <p className="text-sm text-muted-foreground">
              Prices are always calculated in INR. Other currencies are for display and Excel export.
            </p>
          </div>
        </div>
        <SyncChip when={fxLastUpdated} schedule="11:20 AM" />
      </div>

      {/* Action bar */}
      <div className="sticky bottom-4 z-30">
        <div
          className={cn(
            "flex flex-col gap-3 rounded-2xl border px-4 py-3 shadow-[0_12px_32px_-12px_rgba(26,24,22,0.25)] backdrop-blur-xl transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-5",
            dirty ? "border-champagne/50 bg-surface/95" : "border-border/80 bg-surface/90",
          )}
        >
          <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : saving ? (
              <span className="flex items-center gap-2 text-charcoal-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…
              </span>
            ) : dirty ? (
              <span className="flex items-center gap-2 font-medium text-charcoal">
                <span className="h-2 w-2 rounded-full bg-champagne" aria-hidden="true" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className={cn("h-4 w-4", justSaved ? "text-[var(--success)]" : "text-muted-foreground")} aria-hidden="true" />
                {justSaved ? "Saved. New pricing sessions will use these rates." : "All changes saved"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={restoreDefaults} disabled={saving}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Restore defaults
            </Button>
            {dirty ? (
              <Button type="button" variant="outline" size="sm" onClick={discard} disabled={saving}>
                Discard
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!dirty || saving} className="min-w-[120px]">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
