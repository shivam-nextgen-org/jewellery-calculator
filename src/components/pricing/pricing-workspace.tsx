"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calculator,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import {
  ExcelRowsTable,
  type ExcelTableRow,
} from "@/components/pricing/excel-rows-table";
import { StepIndicator } from "@/components/pricing/step-indicator";
import {
  EXCEL_ACCEPT,
  EXCEL_MAX_BYTES,
  diamondShapeFromExtracted,
  downloadSampleExcel,
  parseJewelleryWorkbook,
  selectionFromExtractedRow,
  validateJewelleryRow,
} from "@/lib/excel-workspace";
import { formatINR, formatPercent, formatWeight } from "@/lib/format";
import { parseGoldCode } from "@/lib/gold-code";
import { MOCK_EXTRACTED, MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import {
  clearPricingDraft,
  draftHasActiveSession,
  loadPricingDraft,
  savePricingDraft,
  type PricingEntryMode,
  type StoredExcelRow,
} from "@/lib/pricing-draft";
import {
  buildPurityRateTable,
  calculateAllVariations,
  countVariations,
  validatePricingSession,
  type PricingSessionInput,
  type VariationOverrides,
} from "@/lib/pricing-engine";
import type {
  ChargeCalcType,
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
  JewelleryExtractedData,
  OtherCharge,
  PricingDefaults,
  PricingFormState,
  PricingStep,
  VariationSelection,
} from "@/types/jewellery";
import { cn } from "@/lib/utils";

function pricingFromDefaults(defaults: PricingDefaults): PricingFormState {
  return {
    gold24kRate: defaults.gold24kRate,
    silverRate: defaults.silverRate ?? 0,
    diamondShape: "round",
    diamondRateNatural: defaults.defaultDiamondRateNatural,
    diamondRateLabGrown: defaults.defaultDiamondRateLabGrown,
    diamondRateMoissanite: defaults.defaultDiamondRateMoissanite,
    diamondDiscount: defaults.defaultDiamondDiscount,
    makingCharge: defaults.defaultMakingCharge,
    makingCalcType: defaults.defaultMakingCalcType,
    otherCharges: [
      {
        id: "1",
        name: "Certification",
        amount: defaults.defaultOtherCharge,
        calcType: defaults.defaultOtherCalcType,
      },
    ],
  };
}

const BLANK_EXTRACTED: JewelleryExtractedData = {
  designNo: "",
  category: "",
  goldCode: "",
  goldMetal: "",
  goldPurity: "",
  goldColor: "",
  grossWeight: 0,
  netWeight: 0,
  pureWeight: 0,
  size: "",
  diamondWeight: 0,
  diamondShape: "",
  diamondType: "",
  diamondPurity: "",
  diamondPieces: 0,
  certified: "",
  certificatePrice: null,
};

const METAL_OPTIONS: { id: GoldMetalOption; label: string }[] = [
  { id: "gold", label: "Gold" },
  { id: "silver", label: "Silver" },
];

const GOLD_PURITY_OPTIONS: GoldPurityOption[] = [
  "24K",
  "22K",
  "18K",
  "14K",
  "10K",
  "9K",
];

const SILVER_PURITY_OPTIONS: GoldPurityOption[] = ["999", "958", "925"];

const COLOR_OPTIONS: { id: GoldColorOption; label: string }[] = [
  { id: "yellow", label: "Yellow Gold" },
  { id: "white", label: "White Gold" },
  { id: "rose", label: "Rose Gold" },
];

const SILVER_COLOR_OPTIONS: { id: GoldColorOption; label: string }[] = [
  { id: "sterling", label: "Sterling Silver" },
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

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

function toggleInArray<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

const WIZARD_STEPS: PricingStep[] = [
  "import",
  "verify",
  "price",
  "variations",
  "review",
];

function isWizardStep(value: string | null | undefined): value is PricingStep {
  return Boolean(value && WIZARD_STEPS.includes(value as PricingStep));
}

function readStepFromUrl(): PricingStep | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("step");
  return isWizardStep(raw) ? raw : null;
}

function writeStepToUrl(next: PricingStep, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/pricing";
  url.searchParams.set("step", next);
  const href = `${url.pathname}?${url.searchParams.toString()}`;
  if (mode === "replace") {
    window.history.replaceState({ pricingStep: next }, "", href);
  } else {
    window.history.pushState({ pricingStep: next }, "", href);
  }
}

export function PricingWorkspace({
  initialDefaults,
}: {
  initialDefaults?: PricingDefaults;
}) {
  const router = useRouter();
  const [step, setStepState] = useState<PricingStep>("import");
  const stepRef = useRef<PricingStep>("import");
  const hydratedRef = useRef(false);
  const [entryMode, setEntryMode] = useState<PricingEntryMode>("excel");
  const [excelFileName, setExcelFileName] = useState<string | null>(null);
  const [excelRows, setExcelRows] = useState<ExcelTableRow[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [extracted, setExtracted] =
    useState<JewelleryExtractedData>(BLANK_EXTRACTED);
  const [defaults, setDefaults] = useState<PricingDefaults>(
    initialDefaults ?? MOCK_PRICING_DEFAULTS,
  );
  const [recalcConfirmOpen, setRecalcConfirmOpen] = useState(false);

  const [pricing, setPricing] = useState<PricingFormState>(() =>
    pricingFromDefaults(initialDefaults ?? MOCK_PRICING_DEFAULTS),
  );

  // Diamond discount is opt-in: the field only opens when this is checked.
  const [discountEnabled, setDiscountEnabled] = useState<boolean>(
    () => (pricingFromDefaults(initialDefaults ?? MOCK_PRICING_DEFAULTS).diamondDiscount ?? 0) > 0,
  );

  const [selection, setSelection] = useState<VariationSelection>({
    metals: ["gold"],
    purities: ["10K", "14K", "18K"],
    colors: ["yellow", "white", "rose"],
    diamondTypes: ["natural", "lab-grown"],
  });

  const [overridesByVariationId, setOverridesByVariationId] = useState<
    Record<string, VariationOverrides>
  >({});

  const [isCalculating, setIsCalculating] = useState(false);

  function setStep(next: PricingStep, historyMode: "push" | "replace" | "none" = "push") {
    stepRef.current = next;
    setStepState(next);
    if (historyMode !== "none") {
      writeStepToUrl(next, historyMode);
    }
  }

  function toStoredRows(rows: ExcelTableRow[]): StoredExcelRow[] {
    return rows.map((r) => ({ sheetRow: r.sheetRow, data: r.data }));
  }

  function buildDraft(overrides?: {
    step?: PricingStep;
    calculatedAt?: string | null;
    extracted?: JewelleryExtractedData;
    selection?: VariationSelection;
    overridesByVariationId?: Record<string, VariationOverrides>;
    entryMode?: PricingEntryMode;
    excelFileName?: string | null;
    excelRows?: ExcelTableRow[];
    selectedRowIndex?: number | null;
    resume?: boolean;
  }) {
    const rows = overrides?.excelRows ?? excelRows;
    return {
      version: 2 as const,
      extracted: overrides?.extracted ?? extracted,
      pricing,
      selection: overrides?.selection ?? selection,
      purityPercentages: defaults.purityPercentages,
      overridesByVariationId:
        overrides?.overridesByVariationId ?? overridesByVariationId,
      imageName: null,
      ocrImportId: null,
      step: overrides?.step ?? step,
      calculatedAt:
        overrides?.calculatedAt === undefined ? null : overrides.calculatedAt,
      entryMode: overrides?.entryMode ?? entryMode,
      excelFileName: overrides?.excelFileName ?? excelFileName,
      excelRows: toStoredRows(rows),
      selectedRowIndex:
        overrides?.selectedRowIndex === undefined
          ? selectedRowIndex
          : overrides.selectedRowIndex,
      resume: overrides?.resume,
    };
  }

  function restoreFromDraft(
    draft: NonNullable<ReturnType<typeof loadPricingDraft>>,
  ) {
    setExtracted(draft.extracted);
    setPricing(draft.pricing);
    setDiscountEnabled((draft.pricing.diamondDiscount ?? 0) > 0);
    setSelection({
      ...draft.selection,
      diamondTypes: draft.selection.diamondTypes?.length
        ? draft.selection.diamondTypes
        : ["natural", "lab-grown"],
    });
    setOverridesByVariationId(draft.overridesByVariationId);
    const mode: PricingEntryMode =
      draft.entryMode ??
      (draft.excelRows?.length
        ? "excel"
        : draft.imageName
          ? "excel"
          : "manual");
    setEntryMode(mode);
    setExcelFileName(draft.excelFileName ?? draft.imageName ?? null);

    const stored = (draft.excelRows ?? []) as StoredExcelRow[] | JewelleryExtractedData[];
    const normalized: ExcelTableRow[] = stored.map((row, i) => {
      if (row && typeof row === "object" && "data" in row) {
        const s = row as StoredExcelRow;
        return {
          sheetRow: s.sheetRow,
          data: s.data,
          validation: validateJewelleryRow(s.data),
        };
      }
      const data = row as JewelleryExtractedData;
      return {
        sheetRow: i + 2,
        data,
        validation: validateJewelleryRow(data),
      };
    });

    if (normalized.length) {
      setExcelRows(normalized);
      const byDesign = normalized.findIndex(
        (r) => r.data.designNo === draft.extracted.designNo,
      );
      const idx =
        typeof draft.selectedRowIndex === "number" &&
        draft.selectedRowIndex >= 0 &&
        draft.selectedRowIndex < normalized.length
          ? draft.selectedRowIndex
          : byDesign >= 0
            ? byDesign
            : 0;
      setSelectedRowIndex(idx);
    } else {
      setExcelRows([]);
      setSelectedRowIndex(null);
    }

    // After calculate (step review), Excel sessions return to Verify so the
    // user can pick another row. Explicit Edit Rates sets step to price.
    let nextStep: PricingStep = draft.step;
    if (draft.step === "review") {
      nextStep =
        mode === "excel" && normalized.length > 0 ? "verify" : "price";
    }
    setStep(nextStep, "replace");
    setDefaults((prev) => ({
      ...prev,
      purityPercentages: draft.purityPercentages,
    }));
  }

  // Restore an in-progress Excel/manual session (including browser Back from
  // results). Only clear when there is no active session.
  // Also keep wizard steps in the browser history (?step=) so Back stays
  // inside Import → Verify → Price instead of jumping to Settings.
  useEffect(() => {
    queueMicrotask(() => {
      const draft = loadPricingDraft();
      // Only restore when the user explicitly came back from the results page
      // to edit (draft.resume === true). Every other entry into Jewellery
      // Pricing starts fresh — no leftover data from a previous session.
      if (draft?.resume && draftHasActiveSession(draft)) {
        restoreFromDraft(draft);
        const urlStep = readStepFromUrl();
        if (urlStep && urlStep !== stepRef.current) {
          setStep(urlStep, "replace");
        } else {
          writeStepToUrl(stepRef.current, "replace");
        }
        savePricingDraft({ ...draft, resume: false, step: stepRef.current });
      } else {
        clearPricingDraft();
        setStep("import", "replace");
      }
      hydratedRef.current = true;
    });

    function onPopState() {
      const next = readStepFromUrl() ?? "import";
      const draft = loadPricingDraft();
      const hasData = draftHasActiveSession(draft);

      if (next === "import" || hasData) {
        stepRef.current = next;
        setStepState(next);
        if (draft) {
          savePricingDraft({ ...draft, step: next, resume: false });
        }
      } else {
        // Block jumping to verify/price without data — snap back to import.
        setStep("import", "replace");
      }
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only hydrate + history
  }, []);

  const sessionInput: PricingSessionInput = useMemo(
    () => ({
      netWeight: extracted.netWeight,
      diamondWeight: extracted.diamondWeight,
      gold24kRate: pricing.gold24kRate,
      silverRate: pricing.silverRate ?? defaults.silverRate ?? 0,
      purityPercentages: defaults.purityPercentages,
      metals: selection.metals,
      purities: selection.purities,
      colors: selection.colors,
      diamondTypes: selection.diamondTypes,
      diamondRateNatural: pricing.diamondRateNatural,
      diamondRateLabGrown: pricing.diamondRateLabGrown,
      diamondRateMoissanite: pricing.diamondRateMoissanite,
      diamondDiscountPercent: pricing.diamondDiscount,
      makingCharge: pricing.makingCharge,
      makingCalcType: pricing.makingCalcType,
      otherCharges: pricing.otherCharges.map((c) => ({
        id: c.id,
        name: c.name,
        amount: c.amount,
        calcType: c.calcType,
      })),
      overridesByVariationId,
    }),
    [extracted, pricing, defaults.purityPercentages, selection, overridesByVariationId],
  );

  const validationIssues = useMemo(
    () => validatePricingSession(sessionInput),
    [sessionInput],
  );

  const variationCount = countVariations(
    selection.metals,
    selection.purities,
    selection.colors,
    selection.diamondTypes,
  );

  const pricedVariations = useMemo(() => {
    if (validationIssues.length > 0) return [];
    return calculateAllVariations(sessionInput);
  }, [sessionInput, validationIssues.length]);

  const estimatedPreview = pricedVariations[0]?.calculation.finalPrice ?? "0";

  // Gold purities price off the gold 24K rate; silver purities off the silver
  // rate. Kept as two separate tables so Gold and Silver never mix.
  const goldPurityRates = useMemo(() => {
    const percentages = Object.fromEntries(
      GOLD_PURITY_OPTIONS.filter(
        (p) => defaults.purityPercentages[p] != null,
      ).map((p) => [p, defaults.purityPercentages[p]]),
    );
    return buildPurityRateTable(pricing.gold24kRate, percentages);
  }, [pricing.gold24kRate, defaults.purityPercentages]);

  const silverPurityRates = useMemo(() => {
    const percentages = Object.fromEntries(
      SILVER_PURITY_OPTIONS.filter(
        (p) => defaults.purityPercentages[p] != null,
      ).map((p) => [p, defaults.purityPercentages[p]]),
    );
    return buildPurityRateTable(pricing.silverRate ?? 0, percentages);
  }, [pricing.silverRate, defaults.purityPercentages]);

  const goldSelected = selection.metals.includes("gold");
  const silverSelected = selection.metals.includes("silver");

  const hasOverrides = Object.keys(overridesByVariationId).length > 0;

  async function runCalculate(options?: { clearOverrides?: boolean }) {
    if (validationIssues.length > 0) return;
    setIsCalculating(true);
    setStep("review", "none");

    const nextOverrides = options?.clearOverrides
      ? {}
      : overridesByVariationId;
    if (options?.clearOverrides) {
      setOverridesByVariationId({});
    }

    savePricingDraft(
      buildDraft({
        step: "review",
        calculatedAt: new Date().toISOString(),
        overridesByVariationId: nextOverrides,
      }),
    );

    await new Promise((r) => window.setTimeout(r, 700));
    router.push("/pricing/results");
  }

  function requestRecalculateAll() {
    if (hasOverrides) {
      setRecalcConfirmOpen(true);
      return;
    }
    void runCalculate();
  }

  function confirmRecalculateAll() {
    setRecalcConfirmOpen(false);
    void runCalculate({ clearOverrides: true });
  }

  function applyRowSelection(
    index: number,
    rows: ExcelTableRow[],
    options?: { clearCalc?: boolean },
  ) {
    const row = rows[index];
    if (!row || !row.validation.valid) return;

    const nextSelection = selectionFromExtractedRow(row.data, selection);
    const nextPricing: PricingFormState = {
      ...pricing,
      diamondShape: diamondShapeFromExtracted(row.data, pricing.diamondShape),
    };
    const nextOverrides =
      options?.clearCalc === false ? overridesByVariationId : {};

    setExtracted(row.data);
    setSelectedRowIndex(index);
    setSelection(nextSelection);
    setPricing(nextPricing);
    if (options?.clearCalc !== false) {
      setOverridesByVariationId({});
    }

    savePricingDraft({
      version: 2,
      extracted: row.data,
      pricing: nextPricing,
      selection: nextSelection,
      purityPercentages: defaults.purityPercentages,
      overridesByVariationId: nextOverrides,
      imageName: null,
      ocrImportId: null,
      step: "verify",
      calculatedAt: null,
      entryMode: "excel",
      excelFileName,
      excelRows: toStoredRows(rows),
      selectedRowIndex: index,
    });
  }

  async function handleExcelPick(file?: File | null) {
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (
      !lower.endsWith(".xlsx") &&
      !lower.endsWith(".xls") &&
      !lower.endsWith(".csv")
    ) {
      setImportError("Unsupported file type. Upload .xlsx, .xls, or .csv.");
      return;
    }
    if (file.size > EXCEL_MAX_BYTES) {
      setImportError("File is too large. Maximum size is 5 MB.");
      return;
    }

    setIsProcessing(true);
    setImportError(null);

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseJewelleryWorkbook(buffer, { fileName: file.name });

      if (parsed.fileErrors.length && parsed.rows.length === 0) {
        setImportError(parsed.fileErrors.join(" "));
        return;
      }

      const tableRows: ExcelTableRow[] = parsed.rows.map((r) => ({
        sheetRow: r.sheetRow,
        data: r.data,
        validation: r.validation,
      }));

      const firstValid = tableRows.findIndex((r) => r.validation.valid);
      if (firstValid < 0) {
        setImportError(
          parsed.fileErrors.join(" ") ||
            "No valid rows found. Check Design No and numeric columns.",
        );
        setExcelRows(tableRows);
        setExcelFileName(file.name);
        setEntryMode("excel");
        return;
      }

      setExcelRows(tableRows);
      setExcelFileName(file.name);
      setEntryMode("excel");
      setOverridesByVariationId({});

      const row = tableRows[firstValid];
      const nextSelection = selectionFromExtractedRow(row.data, selection);
      const nextPricing: PricingFormState = {
        ...pricing,
        diamondShape: diamondShapeFromExtracted(row.data, pricing.diamondShape),
      };
      setExtracted(row.data);
      setSelectedRowIndex(firstValid);
      setSelection(nextSelection);
      setPricing(nextPricing);

      const warn =
        parsed.fileErrors.length > 0
          ? parsed.fileErrors.join(" ")
          : parsed.meta.validRowCount < parsed.meta.totalDataRows
            ? `${parsed.meta.validRowCount} of ${parsed.meta.totalDataRows} rows are valid — invalid rows are disabled.`
            : null;
      setImportError(warn);

      savePricingDraft({
        version: 2,
        extracted: row.data,
        pricing: nextPricing,
        selection: nextSelection,
        purityPercentages: defaults.purityPercentages,
        overridesByVariationId: {},
        imageName: null,
        ocrImportId: null,
        step: "verify",
        calculatedAt: null,
        entryMode: "excel",
        excelFileName: file.name,
        excelRows: toStoredRows(tableRows),
        selectedRowIndex: firstValid,
      });
      setStep("verify");
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Failed to read the spreadsheet.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function handleRemoveExcel() {
    setExcelFileName(null);
    setExcelRows([]);
    setSelectedRowIndex(null);
    setImportError(null);
    setEntryMode("excel");
    clearPricingDraft();
    setStep("import");
  }

  function handleStartOver() {
    handleRemoveExcel();
    setExtracted(MOCK_EXTRACTED);
    setOverridesByVariationId({});
  }

  function handleAddManually() {
    setExcelFileName(null);
    setExcelRows([]);
    setSelectedRowIndex(null);
    setEntryMode("manual");
    setExtracted(BLANK_EXTRACTED);
    setImportError(null);
    setSelection((prev) => ({
      ...prev,
      diamondTypes: prev.diamondTypes.length
        ? prev.diamondTypes
        : ["natural", "lab-grown"],
    }));
    setOverridesByVariationId({});
    savePricingDraft(
      buildDraft({
        step: "verify",
        calculatedAt: null,
        extracted: BLANK_EXTRACTED,
        entryMode: "manual",
        excelFileName: null,
        excelRows: [],
        selectedRowIndex: null,
        overridesByVariationId: {},
      }),
    );
    setStep("verify");
  }

  function updateExtracted<K extends keyof JewelleryExtractedData>(
    key: K,
    value: JewelleryExtractedData[K],
  ) {
    const next = { ...extracted, [key]: value };
    setExtracted(next);
    if (entryMode === "excel" && selectedRowIndex != null) {
      setExcelRows((rows) =>
        rows.map((row, i) =>
          i === selectedRowIndex
            ? {
                ...row,
                data: next,
                validation: validateJewelleryRow(next),
              }
            : row,
        ),
      );
    }
  }

  function setExtractedSynced(next: JewelleryExtractedData) {
    setExtracted(next);
    if (entryMode === "excel" && selectedRowIndex != null) {
      setExcelRows((rows) =>
        rows.map((row, i) =>
          i === selectedRowIndex
            ? {
                ...row,
                data: next,
                validation: validateJewelleryRow(next),
              }
            : row,
        ),
      );
    }
  }

  function addCharge() {
    setPricing((prev) => ({
      ...prev,
      otherCharges: [
        ...prev.otherCharges,
        {
          id: String(Date.now()),
          name: "Other",
          amount: 0,
          calcType: "fixed" as ChargeCalcType,
        },
      ],
    }));
  }

  function updateCharge(id: string, patch: Partial<OtherCharge>) {
    setPricing((prev) => ({
      ...prev,
      otherCharges: prev.otherCharges.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    }));
  }

  function removeCharge(id: string) {
    setPricing((prev) => ({
      ...prev,
      otherCharges: prev.otherCharges.filter((c) => c.id !== id),
    }));
  }

  const showPricingLayout =
    step === "price" || step === "variations" || step === "review";

  return (
    <div className="space-y-6">
      {isProcessing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 backdrop-blur-md"
          suppressHydrationWarning
        >
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-8 py-6 shadow-sm">
            <Loader2 className="h-8 w-8 animate-spin text-champagne" />
            <p className="text-sm font-medium text-charcoal">Reading spreadsheet…</p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
            Jewellery Pricing
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
            Pricing Workspace
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Live Decimal engine — gold, diamond, making, and charges update as
            you type.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showPricingLayout && (
            <div className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Est. </span>
              <span className="font-medium">
                {validationIssues.length
                  ? "—"
                  : formatINR(estimatedPreview)}
              </span>
              <span className="mx-2 text-border">·</span>
              <span className="text-champagne">{variationCount} var.</span>
            </div>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="border-b border-border/70 bg-surface-elevated/60 px-4 py-3 sm:px-5">
          <StepIndicator
            current={step}
            onSelect={(s) => {
              const hasData =
                entryMode === "manual" ||
                excelRows.length > 0 ||
                Boolean(excelFileName);
              if (s === "import") setStep("import");
              else if (s === "verify" && hasData) setStep("verify");
              else if (
                (s === "price" || s === "variations" || s === "review") &&
                hasData
              ) {
                setStep(s);
              }
            }}
          />
        </CardContent>

        {step === "import" && (
          <CardContent className="p-5 sm:p-8">
            {excelRows.length > 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-champagne/40 bg-champagne-muted/20 px-6 py-12 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-champagne/30 bg-surface text-champagne">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-charcoal">
                  {excelFileName ?? "Spreadsheet loaded"}
                </h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  {excelRows.length} row{excelRows.length === 1 ? "" : "s"} ready.
                  Continue to Verify to pick another design, or replace the file.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="champagne"
                    className="h-10 px-4 text-sm"
                    onClick={() => {
                      savePricingDraft(buildDraft({ step: "verify" }));
                      setStep("verify");
                    }}
                  >
                    Continue to Verify
                  </Button>
                  <label>
                    <input
                      type="file"
                      accept={EXCEL_ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        void handleExcelPick(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <span className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:border-champagne/40 hover:bg-ivory-deep/60">
                      Replace Excel
                    </span>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 px-4 text-sm"
                    onClick={handleStartOver}
                  >
                    <X />
                    Start over
                  </Button>
                </div>
              </div>
            ) : (
            <div
              className={cn(
                "relative flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-ivory-deep/40 px-6 py-12 text-center transition-colors",
                excelFileName && "border-champagne/40 bg-champagne-muted/20",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleExcelPick(e.dataTransfer.files?.[0]);
              }}
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-champagne/30 bg-surface text-champagne">
                {excelFileName ? (
                  <FileSpreadsheet className="h-6 w-6" />
                ) : (
                  <Upload className="h-6 w-6" />
                )}
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-charcoal">
                {excelFileName ? excelFileName : "Drop jewellery Excel"}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Upload a spreadsheet (.xlsx, .xls, or .csv) with design rows.
                Download the sample template, fill it in, then verify each row
                before pricing. Or add a single piece manually.
              </p>
              {importError && (
                <p className="mt-3 max-w-lg text-sm text-destructive" role="alert">
                  {importError}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <label>
                  <input
                    type="file"
                    accept={EXCEL_ACCEPT}
                    className="sr-only"
                    onChange={(e) => {
                      void handleExcelPick(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:border-champagne/40 hover:bg-ivory-deep/60">
                    Browse Excel
                  </span>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-4 text-sm"
                  onClick={() => downloadSampleExcel()}
                >
                  <Download className="h-4 w-4" />
                  Sample Excel
                </Button>
                <Button
                  type="button"
                  variant="champagne"
                  className="h-10 px-4 text-sm"
                  onClick={handleAddManually}
                >
                  <Plus className="h-4 w-4" />
                  Add manually
                </Button>
                {excelFileName && (
                  <Button
                    variant="ghost"
                    className="h-10 px-4 text-sm"
                    onClick={handleRemoveExcel}
                  >
                    <X />
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                <a
                  href="/samples/jewellery-import-template.xlsx"
                  className="underline-offset-2 hover:underline"
                  download
                >
                  Or download static sample
                </a>
              </p>
            </div>
            )}
          </CardContent>
        )}

        {step === "verify" && (
          <CardContent className="p-0">
            <div className="grid lg:grid-cols-2">
              <div className="min-w-0 border-b border-border/70 bg-ivory-deep/30 p-5 lg:border-b-0 lg:border-r">
                {entryMode === "manual" ? (
                  <>
                    <p className="mb-3 text-xs uppercase tracking-[0.08em] text-muted-foreground">
                      Manual entry
                    </p>
                    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
                      <div className="px-6 text-center">
                        <Plus className="mx-auto h-10 w-10 text-champagne/70" />
                        <p className="mt-2 text-sm font-medium text-charcoal">
                          No spreadsheet — manual entry
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Fill in the fields on the right, then continue to
                          pricing. You can upload Excel anytime from Import.
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <ExcelRowsTable
                    rows={excelRows}
                    selectedIndex={selectedRowIndex}
                    fileName={excelFileName}
                    onSelect={(index) => applyRowSelection(index, excelRows)}
                  />
                )}
              </div>

              <div className="min-w-0 p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      {entryMode === "manual"
                        ? "Enter jewellery data"
                        : "Verify Excel data"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {entryMode === "manual"
                        ? "Type the design values before pricing."
                        : "Edit the selected row before pricing."}
                    </p>
                  </div>
                  <Badge>Editable</Badge>
                </div>

                {entryMode === "excel" &&
                  selectedRowIndex != null &&
                  excelRows[selectedRowIndex]?.validation.warnings.length ? (
                  <div
                    className="mb-4 rounded-lg border border-champagne/40 bg-champagne-muted/30 px-3 py-2 text-sm text-charcoal"
                    role="status"
                  >
                    <ul className="list-disc space-y-0.5 pl-4">
                      {excelRows[selectedRowIndex].validation.warnings.map(
                        (w) => (
                          <li key={w}>{w}</li>
                        ),
                      )}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Design No">
                    <Input
                      value={extracted.designNo}
                      onChange={(e) =>
                        updateExtracted("designNo", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Category">
                    <Input
                      value={extracted.category}
                      onChange={(e) =>
                        updateExtracted("category", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Gold Code">
                    <Input
                      value={extracted.goldCode}
                      placeholder="e.g. G10Y or S925"
                      onChange={(e) => {
                        const code = e.target.value;
                        const parsed = parseGoldCode(code);
                        if (parsed.ok) {
                          setExtractedSynced({
                            ...extracted,
                            goldCode: parsed.normalizedCode,
                            goldMetal: parsed.metalLabel,
                            goldPurity: parsed.purity,
                            goldColor: parsed.colorLabel,
                          });
                        } else {
                          updateExtracted("goldCode", code);
                        }
                      }}
                    />
                  </Field>
                  <Field label="Gold">
                    <Input
                      value={extracted.goldMetal}
                      onChange={(e) =>
                        updateExtracted("goldMetal", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Purity">
                    <Input
                      value={extracted.goldPurity}
                      onChange={(e) =>
                        updateExtracted("goldPurity", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Color">
                    <Input
                      value={extracted.goldColor}
                      onChange={(e) =>
                        updateExtracted("goldColor", e.target.value)
                      }
                    />
                  </Field>
                  {(
                    [
                      ["grossWeight", "Gross Weight (g)", "number"],
                      ["netWeight", "Net Weight (g)", "number"],
                      ["pureWeight", "Pure Weight (g)", "number"],
                      ["size", "Size", "text"],
                      ["diamondWeight", "Diamond Weight (CT)", "number"],
                      ["diamondShape", "Diamond Shape", "text"],
                      ["diamondType", "Diamond Type", "text"],
                      ["diamondPieces", "Diamond Pieces", "number"],
                      ["certified", "Certified", "text"],
                    ] as const
                  ).map(([key, label, type]) =>
                    type === "number" ? (
                      <Field key={key} label={label}>
                        <NumberInput
                          value={Number(extracted[key] ?? 0)}
                          onValueChange={(n) =>
                            updateExtracted(key, n as never)
                          }
                        />
                      </Field>
                    ) : (
                      <Field key={key} label={label}>
                        <Input
                          type={type}
                          value={String(extracted[key] ?? "")}
                          onChange={(e) =>
                            updateExtracted(key, e.target.value as never)
                          }
                        />
                      </Field>
                    ),
                  )}
                  <Field label="Certificate Price (₹)">
                    <Input
                      type="number"
                      value={extracted.certificatePrice ?? ""}
                      placeholder="Optional"
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        updateExtracted(
                          "certificatePrice",
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Keep Excel in memory — Import shows “Continue to Verify”.
                      savePricingDraft(buildDraft({ step: "import" }));
                      setStep("import", "replace");
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => {
                      const typeLower = extracted.diamondType.toLowerCase();
                      const shapeLower = extracted.diamondShape.toLowerCase();
                      setSelection((prev) => ({
                        ...prev,
                        diamondTypes:
                          prev.diamondTypes.length > 0
                            ? prev.diamondTypes
                            : typeLower.includes("lab")
                              ? ["lab-grown", "natural"]
                              : ["natural", "lab-grown"],
                      }));
                      setPricing((p) => ({
                        ...p,
                        diamondShape: (
                          [
                            "round",
                            "princess",
                            "oval",
                            "pear",
                            "marquise",
                            "emerald",
                            "cushion",
                          ] as const
                        ).includes(
                          shapeLower as PricingFormState["diamondShape"],
                        )
                          ? (shapeLower as PricingFormState["diamondShape"])
                          : p.diamondShape,
                      }));
                      savePricingDraft(
                        buildDraft({
                          step: "price",
                          calculatedAt: null,
                        }),
                      );
                      setStep("price", "push");
                    }}
                  >
                    Continue to Pricing
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        )}

        {showPricingLayout && (
          <CardContent className="p-0">
            <div className="grid gap-0 lg:grid-cols-12">
              <aside className="min-w-0 border-b border-border/70 p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
                <h2 className="text-lg font-semibold tracking-tight">Jewellery Data</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  From verified Excel / manual entry
                </p>
                <DataRow label="Design No" value={extracted.designNo} />
                <DataRow label="Category" value={extracted.category} />
                <DataRow
                  label="Net Weight"
                  value={formatWeight(extracted.netWeight)}
                />
                <DataRow
                  label="Diamond Weight"
                  value={formatWeight(extracted.diamondWeight, "CT")}
                />
                <DataRow
                  label="Diamond Pieces"
                  value={String(extracted.diamondPieces)}
                />
                <DataRow
                  label="Gold"
                  value={`${extracted.goldPurity} ${extracted.goldColor}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 px-0"
                  onClick={() => {
                    savePricingDraft(buildDraft({ step: "verify" }));
                    setStep("verify", "replace");
                  }}
                >
                  {entryMode === "excel"
                    ? "Back to Excel rows"
                    : "Edit data"}
                </Button>
              </aside>

              <section className="min-w-0 border-b border-border/70 p-5 lg:col-span-4 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">
                      Variation Configuration
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Live combination count
                    </p>
                  </div>
                  <Badge className="border-charcoal bg-charcoal text-ivory">
                    {variationCount} selected
                  </Badge>
                </div>

                <div className="space-y-5">
                  <div>
                    <Label className="mb-2 block">Gold Metal</Label>
                    <div className="space-y-2">
                      {METAL_OPTIONS.map((opt) => (
                        <label
                          key={opt.id}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                        >
                          <Checkbox
                            checked={selection.metals.includes(opt.id)}
                            onCheckedChange={() =>
                              setSelection((prev) => {
                                // Gold and silver are mutually exclusive — pick
                                // one metal at a time so purities/colors never mix.
                                if (prev.metals.includes(opt.id)) return prev;
                                const isSilver = opt.id === "silver";
                                const allowedPurities = isSilver
                                  ? SILVER_PURITY_OPTIONS
                                  : GOLD_PURITY_OPTIONS;
                                const allowedColors = (
                                  isSilver ? SILVER_COLOR_OPTIONS : COLOR_OPTIONS
                                ).map((c) => c.id);
                                return {
                                  ...prev,
                                  metals: [opt.id],
                                  // Drop purities/colors that don't belong to the new metal.
                                  purities: prev.purities.filter((p) =>
                                    allowedPurities.includes(p),
                                  ),
                                  colors: prev.colors.filter((c) =>
                                    allowedColors.includes(c),
                                  ),
                                };
                              })
                            }
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {goldSelected && (
                    <div>
                      <Label className="mb-2 block">Gold Purity</Label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {GOLD_PURITY_OPTIONS.map((purity) => (
                          <label
                            key={purity}
                            className="flex cursor-pointer items-center gap-2.5 text-sm"
                          >
                            <Checkbox
                              checked={selection.purities.includes(purity)}
                              onCheckedChange={() =>
                                setSelection((prev) => ({
                                  ...prev,
                                  purities: toggleInArray(
                                    prev.purities,
                                    purity,
                                  ),
                                }))
                              }
                            />
                            {purity}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {silverSelected && (
                    <div>
                      <Label className="mb-2 block">Silver Purity</Label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {SILVER_PURITY_OPTIONS.map((purity) => (
                          <label
                            key={purity}
                            className="flex cursor-pointer items-center gap-2.5 text-sm"
                          >
                            <Checkbox
                              checked={selection.purities.includes(purity)}
                              onCheckedChange={() =>
                                setSelection((prev) => ({
                                  ...prev,
                                  purities: toggleInArray(
                                    prev.purities,
                                    purity,
                                  ),
                                }))
                              }
                            />
                            {purity}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="mb-2 block">Color</Label>
                    <div className="space-y-2">
                      {(silverSelected
                        ? SILVER_COLOR_OPTIONS
                        : COLOR_OPTIONS
                      ).map((opt) => (
                        <label
                          key={opt.id}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                        >
                          <Checkbox
                            checked={selection.colors.includes(opt.id)}
                            onCheckedChange={() =>
                              setSelection((prev) => ({
                                ...prev,
                                colors: toggleInArray(prev.colors, opt.id),
                              }))
                            }
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Diamond type</Label>
                    <div className="space-y-2">
                      {(
                        [
                          { id: "natural" as const, label: "Natural" },
                          { id: "lab-grown" as const, label: "Lab Grown" },
                          { id: "moissanite" as const, label: "Moissanite" },
                        ] as const
                      ).map((opt) => (
                        <label
                          key={opt.id}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                        >
                          <Checkbox
                            checked={selection.diamondTypes.includes(opt.id)}
                            onCheckedChange={() =>
                              setSelection((prev) => ({
                                ...prev,
                                diamondTypes: toggleInArray(
                                  prev.diamondTypes,
                                  opt.id,
                                ),
                              }))
                            }
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Each selected type gets its own price rows and rate
                    </p>
                  </div>
                </div>
              </section>

              <section className="min-w-0 p-5 lg:col-span-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold tracking-tight">Pricing</h2>
                  <span className="text-xs text-muted-foreground">
                    All amounts in ₹
                  </span>
                </div>

                {validationIssues.length > 0 && (
                  <div
                    className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                    role="alert"
                  >
                    <ul className="list-disc space-y-0.5 pl-4">
                      {validationIssues.map((issue) => (
                        <li key={issue.field + issue.message}>
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-6">
                  {goldSelected && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-champagne">
                        Gold
                      </p>
                      <Field label="24K Base Rate (₹ / gram)">
                        <NumberInput
                          value={pricing.gold24kRate}
                          onValueChange={(n) =>
                            setPricing((p) => ({ ...p, gold24kRate: n }))
                          }
                        />
                      </Field>
                      <div className="mt-3 overflow-hidden rounded-lg border border-border/80">
                        <table className="w-full text-sm">
                          <tbody>
                            {goldPurityRates.map((row) => (
                              <tr
                                key={row.purity}
                                className="border-b border-border/60 last:border-0"
                              >
                                <td className="px-3 py-2 font-medium">
                                  {row.purity}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {formatPercent(row.percentage)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {formatINR(row.ratePerGram, {
                                    maximumFractionDigits: 0,
                                    minimumFractionDigits: 0,
                                  })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {silverSelected && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-charcoal-muted">
                        Silver
                      </p>
                      <Field label="Silver Rate (₹ / gram)">
                        <NumberInput
                          value={pricing.silverRate}
                          onValueChange={(n) =>
                            setPricing((p) => ({ ...p, silverRate: n }))
                          }
                        />
                      </Field>
                      <div className="mt-3 overflow-hidden rounded-lg border border-border/80">
                        <table className="w-full text-sm">
                          <tbody>
                            {silverPurityRates.map((row) => (
                              <tr
                                key={row.purity}
                                className="border-b border-border/60 last:border-0"
                              >
                                <td className="px-3 py-2 font-medium">
                                  {row.purity}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {formatPercent(row.percentage)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {formatINR(row.ratePerGram, {
                                    maximumFractionDigits: 0,
                                    minimumFractionDigits: 0,
                                  })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-champagne">
                      Diamond
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Shape">
                        <select
                          className="app-select flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
                          value={pricing.diamondShape}
                          onChange={(e) =>
                            setPricing((p) => ({
                              ...p,
                              diamondShape: e.target
                                .value as PricingFormState["diamondShape"],
                            }))
                          }
                        >
                          <option value="round">Round</option>
                          <option value="princess">Princess</option>
                          <option value="oval">Oval</option>
                          <option value="pear">Pear</option>
                          <option value="marquise">Marquise</option>
                          <option value="emerald">Emerald</option>
                          <option value="cushion">Cushion</option>
                        </select>
                      </Field>
                      <div className="space-y-1.5">
                        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-charcoal-muted">
                          <Checkbox
                            checked={discountEnabled}
                            onCheckedChange={(value) => {
                              const on = value === true;
                              setDiscountEnabled(on);
                              if (!on) {
                                // Turning discount off clears it to 0.
                                setPricing((p) => ({
                                  ...p,
                                  diamondDiscount: 0,
                                }));
                              }
                            }}
                          />
                          Apply discount (%)
                        </label>
                        <NumberInput
                          value={pricing.diamondDiscount}
                          disabled={!discountEnabled}
                          onValueChange={(n) =>
                            setPricing((p) => ({ ...p, diamondDiscount: n }))
                          }
                        />
                      </div>
                      <Field label="Natural Rate (₹ / CT)">
                        <NumberInput
                          value={pricing.diamondRateNatural}
                          onValueChange={(n) =>
                            setPricing((p) => ({
                              ...p,
                              diamondRateNatural: n,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Lab Grown Rate (₹ / CT)">
                        <NumberInput
                          value={pricing.diamondRateLabGrown}
                          onValueChange={(n) =>
                            setPricing((p) => ({
                              ...p,
                              diamondRateLabGrown: n,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Moissanite Rate (₹ / CT)">
                        <NumberInput
                          value={pricing.diamondRateMoissanite}
                          onValueChange={(n) =>
                            setPricing((p) => ({
                              ...p,
                              diamondRateMoissanite: n,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Weight auto-filled:{" "}
                      {formatWeight(extracted.diamondWeight, "CT")} · Sheet:{" "}
                      {extracted.diamondType || "—"}
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-champagne">
                      Charges
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Making Charge (₹)">
                        <NumberInput
                          value={pricing.makingCharge}
                          onValueChange={(n) =>
                            setPricing((p) => ({ ...p, makingCharge: n }))
                          }
                        />
                      </Field>
                      <Field label="Calculation Type">
                        <select
                          className="app-select flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
                          value={pricing.makingCalcType}
                          onChange={(e) =>
                            setPricing((p) => ({
                              ...p,
                              makingCalcType: e.target.value as ChargeCalcType,
                            }))
                          }
                        >
                          <option value="per-gram">Per Gram</option>
                          <option value="fixed">Fixed</option>
                          <option value="percentage">Percentage</option>
                        </select>
                      </Field>
                    </div>

                    <div className="mt-4 space-y-2">
                      {pricing.otherCharges.map((charge) => (
                        <div
                          key={charge.id}
                          className="grid grid-cols-[1fr_100px_auto] items-end gap-2"
                        >
                          <Field label="Charge">
                            <Input
                              value={charge.name}
                              onChange={(e) =>
                                updateCharge(charge.id, {
                                  name: e.target.value,
                                })
                              }
                            />
                          </Field>
                          <Field label="₹">
                            <NumberInput
                              value={charge.amount}
                              onValueChange={(n) =>
                                updateCharge(charge.id, { amount: n })
                              }
                            />
                          </Field>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCharge(charge.id)}
                            aria-label="Remove charge"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button variant="soft" size="sm" onClick={addCharge}>
                        <Plus />
                        Add Charge
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-border/70 pt-4">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        className="w-full sm:col-span-2"
                        size="lg"
                        variant="champagne"
                        onClick={() => void runCalculate()}
                        disabled={validationIssues.length > 0 || isCalculating}
                      >
                        {isCalculating ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Calculating…
                          </>
                        ) : (
                          <>
                            <Calculator className="h-4 w-4" />
                            Calculate
                          </>
                        )}
                      </Button>
                      <Button
                        className="w-full"
                        size="lg"
                        variant="outline"
                        onClick={() => {
                          savePricingDraft(buildDraft({ step: "verify" }));
                          setStep("verify", "replace");
                        }}
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Verify
                      </Button>
                      <Button
                        className="w-full"
                        size="lg"
                        variant="outline"
                        onClick={requestRecalculateAll}
                        disabled={validationIssues.length > 0 || isCalculating}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Recalculate All
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {showPricingLayout && isCalculating && (
              <div className="flex flex-col items-center justify-center gap-4 border-t border-border/70 bg-surface-elevated/50 px-5 py-16">
                <DiamondRingMark size={88} />
                <div className="text-center">
                  <p className="text-sm font-medium text-charcoal">
                    Calculating variation prices…
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opening results page with {variationCount} variation
                    {variationCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog open={recalcConfirmOpen} onOpenChange={setRecalcConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recalculate all?</DialogTitle>
            <DialogDescription>
              Manual overrides on variations will be cleared and prices
              recalculated from current rates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRecalcConfirmOpen(false)}
            >
              Keep overrides
            </Button>
            <Button onClick={confirmRecalculateAll}>
              Clear &amp; recalculate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
