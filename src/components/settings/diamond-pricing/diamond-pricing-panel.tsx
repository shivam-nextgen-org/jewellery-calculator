"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Gem,
  Loader2,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { formatINR } from "@/lib/format";
import {
  calculateRateFromGradeProfile,
  defaultBaseClarityForStoneType,
  defaultBaseColorForStoneType,
  defaultClarityRulesForStoneType,
  defaultColorRulesForStoneType,
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

const STONE_TYPES: DiamondTypeOption[] = ["natural", "lab-grown", "moissanite"];

type EditorState = PricingProfileInput & {
  id?: string;
  updatedAt?: string;
  isDefault: boolean;
};

function profileToEditor(profile: PricingProfile): EditorState {
  return {
    id: profile.id,
    name: profile.name,
    stoneType: profile.stoneType,
    basePricePerCt: profile.basePricePerCt,
    baseColorGrade: profile.baseColorGrade,
    baseClarityGrade: profile.baseClarityGrade,
    calculationMethod: profile.calculationMethod,
    colorRules: profile.colorRules.map((r) => ({ ...r })),
    clarityRules: profile.clarityRules.map((r) => ({ ...r })),
    isDefault: profile.isDefault,
    updatedAt: profile.updatedAt,
  };
}

function PercentField({
  value,
  onChange,
  isBase,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  isBase?: boolean;
  disabled?: boolean;
  "aria-label": string;
}) {
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    if (Number(text) !== value && parsePercentageInput(text) !== value) {
      setText(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative w-[7.5rem]">
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled || isBase}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = parsePercentageInput(raw);
          if (parsed != null) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = parsePercentageInput(text);
          const next = parsed ?? 0;
          setText(String(next));
          onChange(next);
        }}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-surface-elevated px-3 pr-8 text-right text-sm tabular-nums text-charcoal",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/40",
          (disabled || isBase) && "cursor-not-allowed opacity-70",
        )}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
}

function RuleRows({
  title,
  rules,
  baseGrade,
  onBaseChange,
  onRuleChange,
  onAdd,
  onRemove,
  kind,
}: {
  title: string;
  rules: PricingGradeRule[];
  baseGrade: string;
  onBaseChange: (grade: string) => void;
  onRuleChange: (index: number, pct: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  kind: "color" | "clarity";
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface-elevated/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-charcoal">{title}</h3>
          <p className="text-xs text-muted-foreground">
            Base {kind} stays at 0%. Other grades can be higher or lower.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Add grade
        </Button>
      </div>

      <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-charcoal-muted">Base {kind}</span>
        <select
          className="app-select h-9 rounded-md border border-input bg-surface pl-3 text-sm"
          value={baseGrade}
          onChange={(e) => onBaseChange(e.target.value)}
          aria-label={`Base ${kind}`}
        >
          {rules.map((r) => (
            <option key={r.grade} value={r.grade}>
              {r.grade}
            </option>
          ))}
        </select>
      </label>

      <ul className="space-y-2">
        {rules.map((rule, index) => {
          const isBase = rule.grade === baseGrade;
          return (
            <li
              key={`${rule.grade}-${index}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-surface px-3 py-2"
            >
              <span className="min-w-[4.5rem] font-medium tabular-nums text-charcoal">
                {rule.grade}
              </span>
              {isBase ? (
                <span className="rounded-full bg-champagne-muted/60 px-2 py-0.5 text-[11px] font-medium text-charcoal">
                  Base · 0%
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <PercentField
                  aria-label={`${rule.grade} ${kind} adjustment`}
                  value={isBase ? 0 : rule.adjustmentPercent}
                  isBase={isBase}
                  onChange={(n) => onRuleChange(index, n)}
                />
                {!isBase ? (
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${rule.grade}`}
                    onClick={() => onRemove(index)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="w-8" aria-hidden="true" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LivePreview({ editor }: { editor: EditorState }) {
  const [colorGrade, setColorGrade] = useState(editor.baseColorGrade);
  const [clarityGrade, setClarityGrade] = useState(editor.baseClarityGrade);
  const [carat, setCarat] = useState(1);
  const [matrixOpen, setMatrixOpen] = useState(false);

  useEffect(() => {
    if (!editor.colorRules.some((r) => r.grade === colorGrade)) {
      setColorGrade(editor.baseColorGrade);
    }
  }, [editor.colorRules, editor.baseColorGrade, colorGrade]);

  useEffect(() => {
    if (!editor.clarityRules.some((r) => r.grade === clarityGrade)) {
      setClarityGrade(editor.baseClarityGrade);
    }
  }, [editor.clarityRules, editor.baseClarityGrade, clarityGrade]);

  const preview = useMemo(
    () =>
      calculateRateFromGradeProfile({
        basePricePerCt: editor.basePricePerCt,
        colorRules: editor.colorRules,
        clarityRules: editor.clarityRules,
        colorGrade,
        clarityGrade,
        calculationMethod: editor.calculationMethod,
      }),
    [editor, colorGrade, clarityGrade],
  );

  const totalPrice = Number(preview.ratePerCt) * carat;

  const matrixColors = editor.colorRules.slice(0, 6);
  const matrixClarities = editor.clarityRules.slice(0, 5);

  return (
    <div className="rounded-xl border border-border/70 bg-surface p-4 shadow-[0_1px_2px_rgba(26,24,22,0.04)]">
      <h3 className="font-display text-lg font-semibold text-charcoal">
        Pricing preview
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Change color, clarity, or carat to see the final rate instantly.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-charcoal-muted">Diamond color</span>
          <select
            className="app-select h-10 w-full rounded-md border border-input bg-surface-elevated pl-3 text-sm"
            value={colorGrade}
            onChange={(e) => setColorGrade(e.target.value)}
          >
            {editor.colorRules.map((r) => (
              <option key={r.grade} value={r.grade}>
                {r.grade}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-charcoal-muted">Clarity</span>
          <select
            className="app-select h-10 w-full rounded-md border border-input bg-surface-elevated pl-3 text-sm"
            value={clarityGrade}
            onChange={(e) => setClarityGrade(e.target.value)}
          >
            {editor.clarityRules.map((r) => (
              <option key={r.grade} value={r.grade}>
                {r.grade}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-charcoal-muted">Carat</span>
          <NumberInput
            value={carat}
            onValueChange={setCarat}
            className="h-10 tabular-nums"
            aria-label="Preview carat"
            min={0}
            step={0.01}
          />
        </label>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Base</dt>
          <dd className="tabular-nums text-charcoal">
            {formatINR(editor.basePricePerCt)} / ct
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Color adjustment</dt>
          <dd className="tabular-nums text-charcoal">
            {formatAdjustmentPercent(preview.colorAdjustmentPercent)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Clarity adjustment</dt>
          <dd className="tabular-nums text-charcoal">
            {formatAdjustmentPercent(preview.clarityAdjustmentPercent)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border/60 pt-2">
          <dt className="text-muted-foreground">
            {editor.calculationMethod === "sequential"
              ? "Combined (step by step)"
              : "Total adjustment"}
          </dt>
          <dd className="tabular-nums text-charcoal">
            {formatAdjustmentPercent(Number(preview.totalAdjustmentPercent))}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-medium text-charcoal">Final price</dt>
          <dd className="font-semibold tabular-nums text-charcoal">
            {formatINR(totalPrice)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({formatINR(Number(preview.ratePerCt))} / ct)
            </span>
          </dd>
        </div>
      </dl>

      <button
        type="button"
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-left text-sm text-charcoal hover:bg-ivory-deep/50"
        onClick={() => setMatrixOpen((v) => !v)}
        aria-expanded={matrixOpen}
      >
        <span>Preview matrix</span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", matrixOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {matrixOpen ? (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border/60">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-ivory-deep/80 text-charcoal-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Color</th>
                {matrixClarities.map((c) => (
                  <th key={c.grade} className="px-2 py-2 font-medium tabular-nums">
                    {c.grade}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixColors.map((color) => (
                <tr key={color.grade} className="border-t border-border/40">
                  <th className="px-2 py-2 font-medium text-charcoal">{color.grade}</th>
                  {matrixClarities.map((clarity) => {
                    const cell = calculateRateFromGradeProfile({
                      basePricePerCt: editor.basePricePerCt,
                      colorRules: editor.colorRules,
                      clarityRules: editor.clarityRules,
                      colorGrade: color.grade,
                      clarityGrade: clarity.grade,
                      calculationMethod: editor.calculationMethod,
                    });
                    return (
                      <td key={clarity.grade} className="px-2 py-2 tabular-nums text-charcoal">
                        {formatINR(Number(cell.ratePerCt), { maximumFractionDigits: 0 })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function DiamondPricingPanel() {
  const [stoneType, setStoneType] = useState<DiamondTypeOption>("natural");
  const [profiles, setProfiles] = useState<PricingProfile[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGradeName, setNewGradeName] = useState<{ kind: "color" | "clarity"; value: string } | null>(null);

  const dirty = useMemo(
    () => (editor ? JSON.stringify(editor) !== baseline : false),
    [editor, baseline],
  );

  const loadProfiles = useCallback(async (type: DiamondTypeOption, preferId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pricing-profiles?stoneType=${encodeURIComponent(type)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to load pricing profiles");
      }
      const list = (await res.json()) as PricingProfile[];
      setProfiles(list);
      const selected =
        (preferId ? list.find((p) => p.id === preferId) : null) ??
        list.find((p) => p.isDefault) ??
        list[0] ??
        null;
      if (selected) {
        const next = profileToEditor(selected);
        setEditor(next);
        setBaseline(JSON.stringify(next));
      } else {
        setEditor(null);
        setBaseline("");
      }
      setJustSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pricing profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles(stoneType);
  }, [stoneType, loadProfiles]);

  const selectProfile = useCallback(
    (profile: PricingProfile) => {
      if (dirty && !window.confirm("Discard unsaved changes?")) return;
      const next = profileToEditor(profile);
      setEditor(next);
      setBaseline(JSON.stringify(next));
      setJustSaved(false);
      setError(null);
    },
    [dirty],
  );

  const save = useCallback(async () => {
    if (!editor || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: PricingProfileInput = {
        name: editor.name,
        stoneType: editor.stoneType,
        basePricePerCt: editor.basePricePerCt,
        baseColorGrade: editor.baseColorGrade,
        baseClarityGrade: editor.baseClarityGrade,
        calculationMethod: editor.calculationMethod,
        colorRules: editor.colorRules,
        clarityRules: editor.clarityRules,
        isDefault: editor.isDefault,
        updatedAt: editor.updatedAt,
      };

      const res = await fetch(
        editor.id ? `/api/pricing-profiles/${editor.id}` : "/api/pricing-profiles",
        {
          method: editor.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to save pricing profile. Please try again.");
      }
      const saved = (await res.json()) as PricingProfile;
      await loadProfiles(saved.stoneType, saved.id);
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save pricing profile.");
    } finally {
      setSaving(false);
    }
  }, [editor, saving, loadProfiles]);

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

  async function createProfile() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setSaving(true);
    setError(null);
    try {
      const defaultBase =
        profiles.find((p) => p.isDefault)?.basePricePerCt ??
        profiles[0]?.basePricePerCt ??
        100000;
      const res = await fetch("/api/pricing-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${stoneTypeLabel(stoneType)} — Custom`,
          stoneType,
          basePricePerCt: defaultBase,
          baseColorGrade: defaultBaseColorForStoneType(stoneType),
          baseClarityGrade: defaultBaseClarityForStoneType(stoneType),
          calculationMethod: "additive" as PricingCalculationMethod,
          colorRules: defaultColorRulesForStoneType(stoneType),
          clarityRules: defaultClarityRulesForStoneType(stoneType),
          isDefault: profiles.length === 0,
        } satisfies PricingProfileInput),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to create profile.");
      }
      const created = (await res.json()) as PricingProfile;
      await loadProfiles(stoneType, created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create profile.");
    } finally {
      setSaving(false);
    }
  }

  async function setAsDefault(profileId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/pricing-profiles/${profileId}/set-default`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to set default.");
      }
      await loadProfiles(stoneType, profileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to set default.");
    }
  }

  async function archiveSelected() {
    if (!editor?.id) return;
    if (!window.confirm("Archive this pricing profile?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pricing-profiles/${editor.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to archive profile.");
      }
      await loadProfiles(stoneType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive profile.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!baseline) return;
    setEditor(JSON.parse(baseline) as EditorState);
    setError(null);
  }

  function updateEditor(patch: Partial<EditorState>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
    setJustSaved(false);
  }

  function setBaseColor(grade: string) {
    if (!editor) return;
    const colorRules = editor.colorRules.map((r) =>
      r.grade === grade
        ? { ...r, adjustmentPercent: 0 }
        : r.grade === editor.baseColorGrade && r.adjustmentPercent === 0
          ? r
          : r,
    );
    // Force new base to 0
    const nextRules = colorRules.map((r) =>
      r.grade === grade ? { ...r, adjustmentPercent: 0 } : r,
    );
    updateEditor({ baseColorGrade: grade, colorRules: nextRules });
  }

  function setBaseClarity(grade: string) {
    if (!editor) return;
    const nextRules = editor.clarityRules.map((r) =>
      r.grade === grade ? { ...r, adjustmentPercent: 0 } : r,
    );
    updateEditor({ baseClarityGrade: grade, clarityRules: nextRules });
  }

  function promptAddGrade(kind: "color" | "clarity") {
    setNewGradeName({ kind, value: "" });
  }

  function commitAddGrade() {
    if (!editor || !newGradeName) return;
    const grade = newGradeName.value.trim();
    if (!grade) {
      setNewGradeName(null);
      return;
    }
    if (newGradeName.kind === "color") {
      if (editor.colorRules.some((r) => r.grade === grade)) {
        setError(`Color grade ${grade} already exists.`);
        setNewGradeName(null);
        return;
      }
      updateEditor({
        colorRules: [...editor.colorRules, { grade, adjustmentPercent: 0 }],
      });
    } else {
      if (editor.clarityRules.some((r) => r.grade === grade)) {
        setError(`Clarity grade ${grade} already exists.`);
        setNewGradeName(null);
        return;
      }
      updateEditor({
        clarityRules: [...editor.clarityRules, { grade, adjustmentPercent: 0 }],
      });
    }
    setNewGradeName(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
            <Gem className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold text-charcoal">
              Diamond pricing
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set a base price per carat, then adjust by diamond color and clarity.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-full border border-border/70 bg-ivory-deep/70 p-1">
          {STONE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                if (dirty && !window.confirm("Discard unsaved changes?")) return;
                setStoneType(type);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                stoneType === type
                  ? "bg-surface text-charcoal shadow-[0_1px_3px_rgba(26,24,22,0.10)]"
                  : "text-charcoal-muted hover:text-charcoal",
              )}
            >
              {stoneTypeLabel(type)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading profiles…
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          <aside className="space-y-3 lg:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-charcoal">Profiles</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void createProfile()}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                New
              </Button>
            </div>
            <ul className="space-y-2">
              {profiles.map((profile) => (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => selectProfile(profile)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      editor?.id === profile.id
                        ? "border-champagne/60 bg-champagne-muted/30"
                        : "border-border/70 bg-surface hover:border-champagne-soft",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-charcoal">
                        {profile.name}
                      </span>
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {formatINR(profile.basePricePerCt)} / ct
                      </span>
                    </span>
                    {profile.isDefault ? (
                      <Star
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-champagne text-champagne"
                        aria-label="Default profile"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="space-y-5 lg:col-span-9">
            {editor ? (
              <>
                <div className="grid gap-5 xl:grid-cols-5">
                  <div className="space-y-4 xl:col-span-3">
                    <div className="rounded-2xl border border-border/80 bg-surface p-5 shadow-[0_1px_2px_rgba(26,24,22,0.04)]">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm sm:col-span-2">
                          <span className="mb-1 block text-charcoal-muted">Profile name</span>
                          <input
                            className="h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
                            value={editor.name}
                            onChange={(e) => updateEditor({ name: e.target.value })}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-charcoal-muted">Base price</span>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                              ₹
                            </span>
                            <NumberInput
                              value={editor.basePricePerCt}
                              onValueChange={(n) => updateEditor({ basePricePerCt: n })}
                              className="h-10 pl-7 pr-12 tabular-nums"
                              aria-label="Base price per carat"
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                              / ct
                            </span>
                          </div>
                        </label>
                        <div className="flex flex-col justify-end gap-2">
                          <label className="flex items-center gap-2 text-sm text-charcoal">
                            <input
                              type="checkbox"
                              checked={editor.isDefault}
                              onChange={(e) => updateEditor({ isDefault: e.target.checked })}
                              className="rounded border-input"
                            />
                            Use as default for {stoneTypeLabel(stoneType)}
                          </label>
                          {editor.id && !editor.isDefault ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="self-start"
                              onClick={() => void setAsDefault(editor.id!)}
                            >
                              Set as default now
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <fieldset className="mt-5">
                        <legend className="text-sm font-semibold text-charcoal">
                          Pricing calculation method
                        </legend>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label
                            className={cn(
                              "cursor-pointer rounded-xl border p-3",
                              editor.calculationMethod === "additive"
                                ? "border-champagne/60 bg-champagne-muted/20"
                                : "border-border/70",
                            )}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              name="calc-method"
                              checked={editor.calculationMethod === "additive"}
                              onChange={() => updateEditor({ calculationMethod: "additive" })}
                            />
                            <span className="block text-sm font-medium text-charcoal">
                              Additive — Recommended
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Color % + Clarity % combined, then applied once to the base price.
                            </span>
                          </label>
                          <label
                            className={cn(
                              "cursor-pointer rounded-xl border p-3",
                              editor.calculationMethod === "sequential"
                                ? "border-champagne/60 bg-champagne-muted/20"
                                : "border-border/70",
                            )}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              name="calc-method"
                              checked={editor.calculationMethod === "sequential"}
                              onChange={() => updateEditor({ calculationMethod: "sequential" })}
                            />
                            <span className="block text-sm font-medium text-charcoal">
                              Sequential
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Apply color %, then apply clarity % on the result.
                            </span>
                          </label>
                        </div>
                      </fieldset>
                    </div>

                    <RuleRows
                      title="Color pricing"
                      kind="color"
                      rules={editor.colorRules}
                      baseGrade={editor.baseColorGrade}
                      onBaseChange={setBaseColor}
                      onRuleChange={(index, pct) => {
                        const colorRules = editor.colorRules.map((r, i) =>
                          i === index ? { ...r, adjustmentPercent: pct } : r,
                        );
                        updateEditor({ colorRules });
                      }}
                      onAdd={() => promptAddGrade("color")}
                      onRemove={(index) => {
                        const rule = editor.colorRules[index];
                        if (rule.grade === editor.baseColorGrade) return;
                        updateEditor({
                          colorRules: editor.colorRules.filter((_, i) => i !== index),
                        });
                      }}
                    />

                    <RuleRows
                      title="Clarity pricing"
                      kind="clarity"
                      rules={editor.clarityRules}
                      baseGrade={editor.baseClarityGrade}
                      onBaseChange={setBaseClarity}
                      onRuleChange={(index, pct) => {
                        const clarityRules = editor.clarityRules.map((r, i) =>
                          i === index ? { ...r, adjustmentPercent: pct } : r,
                        );
                        updateEditor({ clarityRules });
                      }}
                      onAdd={() => promptAddGrade("clarity")}
                      onRemove={(index) => {
                        const rule = editor.clarityRules[index];
                        if (rule.grade === editor.baseClarityGrade) return;
                        updateEditor({
                          clarityRules: editor.clarityRules.filter((_, i) => i !== index),
                        });
                      }}
                    />
                  </div>

                  <div className="xl:col-span-2">
                    <LivePreview editor={editor} />
                    {editor.id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3 w-full text-destructive hover:bg-destructive/10"
                        onClick={() => void archiveSelected()}
                      >
                        Archive profile
                      </Button>
                    ) : null}
                  </div>
                </div>

                {newGradeName ? (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4">
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="add-grade-title"
                      className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-lg"
                    >
                      <h3 id="add-grade-title" className="font-display text-lg font-semibold">
                        Add {newGradeName.kind} grade
                      </h3>
                      <input
                        autoFocus
                        className="mt-3 h-10 w-full rounded-md border border-input px-3 text-sm"
                        value={newGradeName.value}
                        onChange={(e) =>
                          setNewGradeName({ ...newGradeName, value: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitAddGrade();
                          }
                          if (e.key === "Escape") setNewGradeName(null);
                        }}
                        placeholder={newGradeName.kind === "color" ? "e.g. N" : "e.g. SI3"}
                      />
                      <div className="mt-4 flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setNewGradeName(null)}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={commitAddGrade}>
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="sticky bottom-4 z-30">
                  <div
                    className={cn(
                      "flex flex-col gap-3 rounded-2xl border px-4 py-3 shadow-[0_12px_32px_-12px_rgba(26,24,22,0.25)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-5",
                      dirty
                        ? "border-champagne/50 bg-surface/95"
                        : "border-border/80 bg-surface/90",
                    )}
                  >
                    <div className="text-sm" role="status" aria-live="polite">
                      {error ? (
                        <span className="text-destructive">{error}</span>
                      ) : saving ? (
                        <span className="flex items-center gap-2 text-charcoal-muted">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…
                        </span>
                      ) : dirty ? (
                        <span className="font-medium text-charcoal">Unsaved changes</span>
                      ) : (
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {justSaved ? "Saved" : "All changes saved"}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {dirty ? (
                        <Button type="button" variant="outline" size="sm" onClick={discard}>
                          Discard
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        disabled={!dirty || saving}
                        className="min-w-[120px]"
                        onClick={() => void save()}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No profiles yet. Create one to configure color and clarity pricing.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
