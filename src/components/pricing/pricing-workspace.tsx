"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ClipboardPaste,
  ImageIcon,
  Loader2,
  Plus,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { BouncingRing, DiamondRingMark } from "@/components/brand/diamond-ring";
import { StepIndicator } from "@/components/pricing/step-indicator";
import { formatINR, formatPercent, formatWeight } from "@/lib/format";
import {
  parseGoldCode,
  variationHintsFromGoldCode,
} from "@/lib/gold-code";
import { MOCK_EXTRACTED, MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import {
  clearPricingDraft,
  loadPricingDraft,
  savePricingDraft,
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
  DiamondTypeOption,
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
    diamondShape: "round",
    diamondRateNatural: defaults.defaultDiamondRateNatural,
    diamondRateLabGrown: defaults.defaultDiamondRateLabGrown,
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

const METAL_OPTIONS: { id: GoldMetalOption; label: string }[] = [
  { id: "gold", label: "Gold" },
  { id: "silver", label: "Silver" },
  { id: "platinum", label: "Platinum" },
];

const PURITY_OPTIONS: GoldPurityOption[] = [
  "10K",
  "14K",
  "18K",
  "22K",
  "9K",
  "925",
  "999",
];

const COLOR_OPTIONS: { id: GoldColorOption; label: string }[] = [
  { id: "yellow", label: "Yellow Gold" },
  { id: "white", label: "White Gold" },
  { id: "rose", label: "Rose Gold" },
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

export function PricingWorkspace({
  initialDefaults,
}: {
  initialDefaults?: PricingDefaults;
}) {
  const router = useRouter();
  const [step, setStep] = useState<PricingStep>("import");
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrImportId, setOcrImportId] = useState<string | null>(null);
  const [ocrMeta, setOcrMeta] = useState<{
    provider: string;
    confidence: number;
    warnings: string[];
    goldCodeParsed: boolean;
    unknownGoldCode: boolean;
    rawText?: string;
  } | null>(null);
  const [extracted, setExtracted] =
    useState<JewelleryExtractedData>(MOCK_EXTRACTED);
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

  // Start fresh when entering /pricing normally (e.g. via the nav tab). But if
  // the user came back from the results page to edit (draft.resume === true),
  // restore their work and land on the step they chose. The resume flag is
  // consumed (cleared) so a later plain visit still starts fresh.
  useEffect(() => {
    const draft = loadPricingDraft();
    if (!draft?.resume) {
      clearPricingDraft();
      return;
    }
    // Restore asynchronously so we don't call setState synchronously in the
    // effect body (avoids cascading-render warnings).
    queueMicrotask(() => {
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
      setImageName(draft.imageName);
      setOcrImportId(draft.ocrImportId);
      setStep(draft.step === "review" ? "price" : draft.step);
      setDefaults((prev) => ({
        ...prev,
        purityPercentages: draft.purityPercentages,
      }));
      // Consume the resume flag so a future plain visit starts fresh.
      savePricingDraft({ ...draft, resume: false });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  const sessionInput: PricingSessionInput = useMemo(
    () => ({
      netWeight: extracted.netWeight,
      diamondWeight: extracted.diamondWeight,
      gold24kRate: pricing.gold24kRate,
      purityPercentages: defaults.purityPercentages,
      metals: selection.metals,
      purities: selection.purities,
      colors: selection.colors,
      diamondTypes: selection.diamondTypes,
      diamondRateNatural: pricing.diamondRateNatural,
      diamondRateLabGrown: pricing.diamondRateLabGrown,
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

  const purityRates = useMemo(
    () =>
      buildPurityRateTable(pricing.gold24kRate, defaults.purityPercentages),
    [pricing.gold24kRate, defaults.purityPercentages],
  );

  const hasOverrides = Object.keys(overridesByVariationId).length > 0;

  async function runCalculate(options?: { clearOverrides?: boolean }) {
    if (validationIssues.length > 0) return;
    setIsCalculating(true);
    setStep("review");

    const nextOverrides = options?.clearOverrides
      ? {}
      : overridesByVariationId;
    if (options?.clearOverrides) {
      setOverridesByVariationId({});
    }

    savePricingDraft({
      version: 1,
      extracted,
      pricing,
      selection,
      purityPercentages: defaults.purityPercentages,
      overridesByVariationId: nextOverrides,
      imageName,
      ocrImportId,
      step: "review",
      calculatedAt: new Date().toISOString(),
    });

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

  async function handleProcessImage() {
    if (!imageFile) {
      setOcrError("Please browse or drop an image file first.");
      return;
    }
    setIsProcessing(true);
    setOcrError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 100_000);
    try {
      const form = new FormData();
      form.append("file", imageFile);

      const res = await fetch("/api/ocr/process", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const body = (await res.json()) as {
        error?: string;
        importId?: string;
        data?: JewelleryExtractedData;
        meta?: {
          provider: string;
          confidence: number;
          warnings: string[];
          goldCodeParsed: boolean;
          unknownGoldCode: boolean;
        };
      };

      if (!res.ok || !body.data) {
        throw new Error(body.error ?? "OCR failed");
      }

      setExtracted(body.data);
      setOcrImportId(body.importId ?? null);
      setOcrMeta(body.meta ?? null);

      // Pre-select variations from parsed gold code (user can expand later)
      const parsed = parseGoldCode(body.data.goldCode);
      let nextSelection: VariationSelection = {
        ...selection,
        diamondTypes: ["natural", "lab-grown"],
      };
      if (parsed.ok) {
        const hints = variationHintsFromGoldCode(parsed);
        const sheetDia = body.data.diamondType.toLowerCase();
        const preferredDia: DiamondTypeOption[] = sheetDia.includes("lab")
          ? ["lab-grown", "natural"]
          : sheetDia.includes("natural")
            ? ["natural", "lab-grown"]
            : ["natural", "lab-grown"];
        nextSelection = {
          metals: hints.metals,
          purities: Array.from(
            new Set([...hints.purities, "14K", "18K"]),
          ) as GoldPurityOption[],
          colors: ["yellow", "white", "rose"],
          diamondTypes: preferredDia,
        };
        setSelection(nextSelection);
      } else {
        setSelection(nextSelection);
      }

      // Shape hint from sheet
      const shapeLower = body.data.diamondShape.toLowerCase();
      setPricing((p) => ({
        ...p,
        diamondShape: shapeLower.includes("pear")
          ? "pear"
          : shapeLower.includes("pri") || shapeLower.includes("princess")
            ? "princess"
            : shapeLower.includes("oval")
              ? "oval"
              : "round",
      }));

      savePricingDraft({
        version: 1,
        extracted: body.data,
        pricing,
        selection: nextSelection,
        purityPercentages: defaults.purityPercentages,
        overridesByVariationId: {},
        imageName,
        ocrImportId: body.importId ?? null,
        step: "verify",
        calculatedAt: null,
      });
      setOverridesByVariationId({});

      setStep("verify");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setOcrError(
          "OCR timed out. Check tessdata (npm run ocr:tessdata) and try a smaller image.",
        );
      } else {
        setOcrError(err instanceof Error ? err.message : "OCR failed");
      }
    } finally {
      window.clearTimeout(timeout);
      setIsProcessing(false);
    }
  }

  function handleFilePick(file?: File | null) {
    if (!file) return;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(file);
    setImageName(file.name);
    setImagePreviewUrl(URL.createObjectURL(file));
    setOcrError(null);
  }

  // Button fallback: read an image from the clipboard on demand.
  async function handlePasteFromClipboard() {
    try {
      if (!navigator.clipboard?.read) {
        setOcrError("Paste isn't supported here — use Ctrl+V or Browse.");
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          const ext = type.split("/")[1] || "png";
          handleFilePick(
            new File([blob], `pasted-${Date.now()}.${ext}`, { type }),
          );
          return;
        }
      }
      setOcrError("No image found in the clipboard.");
    } catch {
      setOcrError(
        "Couldn't read the clipboard. Try Ctrl+V or Browse instead.",
      );
    }
  }

  // Paste an image straight from the clipboard (e.g. after taking a
  // screenshot). Only active on the import step.
  useEffect(() => {
    if (step !== "import") return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const ext = item.type.split("/")[1] || "png";
            const named = new File([blob], `pasted-${Date.now()}.${ext}`, {
              type: item.type,
            });
            handleFilePick(named);
          }
          return;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, imagePreviewUrl]);

  function handleRemoveImage() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImageName(null);
    setImagePreviewUrl(null);
    setOcrImportId(null);
    setOcrMeta(null);
    setOcrError(null);
  }

  function updateExtracted<K extends keyof JewelleryExtractedData>(
    key: K,
    value: JewelleryExtractedData[K],
  ) {
    setExtracted((prev) => ({ ...prev, [key]: value }));
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
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
          suppressHydrationWarning
        >
          <BouncingRing size={140} label="Reading image" />
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
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </Button>
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
              if (s === "import") setStep("import");
              else if (s === "verify" && imageName) setStep("verify");
              else if (
                (s === "price" || s === "variations" || s === "review") &&
                imageName
              ) {
                setStep(s);
              }
            }}
          />
        </CardContent>

        {step === "import" && (
          <CardContent className="p-5 sm:p-8">
            <div
              className={cn(
                "relative flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-ivory-deep/40 px-6 py-12 text-center transition-colors",
                imageName && "border-champagne/40 bg-champagne-muted/20",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFilePick(e.dataTransfer.files?.[0]);
              }}
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-champagne/30 bg-surface text-champagne">
                {imageName ? (
                  <ImageIcon className="h-6 w-6" />
                ) : (
                  <Upload className="h-6 w-6" />
                )}
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-charcoal">
                {imageName ? imageName : "Drop jewellery image"}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Drag &amp; drop, browse, or paste (Ctrl+V) a clear design-sheet
                photo. Real OCR (Tesseract) reads the image — verify fields
                before pricing. First run may take longer while language data
                downloads.
              </p>
              {ocrError && (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  {ocrError}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <label>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => handleFilePick(e.target.files?.[0])}
                  />
                  <span className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:border-champagne/40 hover:bg-ivory-deep/60">
                    Browse image
                  </span>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-4 text-sm"
                  onClick={handlePasteFromClipboard}
                >
                  <ClipboardPaste className="h-4 w-4" />
                  Paste image
                </Button>
                {imageName && (
                  <>
                    <Button
                      variant="ghost"
                      className="h-10 px-4 text-sm"
                      onClick={handleRemoveImage}
                    >
                      <X />
                      Remove
                    </Button>
                    <Button
                      variant="champagne"
                      className="h-10 px-4 text-sm"
                      onClick={handleProcessImage}
                      disabled={isProcessing}
                    >
                      {isProcessing ? "Reading image…" : "Process image"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        )}

        {step === "verify" && (
          <CardContent className="p-0">
            <div className="grid lg:grid-cols-2">
              <div className="border-b border-border/70 bg-ivory-deep/30 p-5 lg:border-b-0 lg:border-r">
                <p className="mb-3 text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  Original image
                </p>
                <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
                  {imagePreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imagePreviewUrl}
                      alt={imageName ?? "Uploaded jewellery sheet"}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="text-center">
                      <ImageIcon className="mx-auto h-10 w-10 text-champagne/70" />
                      <p className="mt-2 text-sm text-muted-foreground">
                        {imageName ?? "design-sheet.jpg"}
                      </p>
                    </div>
                  )}
                </div>
                {ocrMeta && (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>
                      Provider:{" "}
                      <span className="font-medium text-charcoal">
                        {ocrMeta.provider}
                      </span>{" "}
                      · Confidence{" "}
                      {Math.round(ocrMeta.confidence * 100)}%
                      {ocrImportId ? ` · Import ${ocrImportId.slice(0, 8)}` : ""}
                    </p>
                    {ocrMeta.goldCodeParsed && (
                      <p className="text-[var(--success)]">
                        Gold code parsed successfully
                      </p>
                    )}
                    {ocrMeta.unknownGoldCode && (
                      <p className="text-destructive">
                        Unknown gold code — please correct below
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      Verify extracted data
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Correct OCR mistakes before pricing.
                    </p>
                  </div>
                  <Badge>Editable</Badge>
                </div>

                {ocrMeta && ocrMeta.warnings.length > 0 && (
                  <div
                    className="mb-4 rounded-lg border border-champagne/40 bg-champagne-muted/30 px-3 py-2 text-sm text-charcoal"
                    role="status"
                  >
                    <ul className="list-disc space-y-0.5 pl-4">
                      {ocrMeta.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {ocrMeta?.rawText ? (
                  <details className="mb-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                    <summary className="cursor-pointer select-none font-medium text-charcoal">
                      Raw OCR text (what the scanner read)
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                      {ocrMeta.rawText}
                    </pre>
                  </details>
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
                          setExtracted((prev) => ({
                            ...prev,
                            goldCode: parsed.normalizedCode,
                            goldMetal: parsed.metalLabel,
                            goldPurity: parsed.purity,
                            goldColor: parsed.colorLabel,
                          }));
                          setOcrMeta((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  goldCodeParsed: true,
                                  unknownGoldCode: false,
                                  warnings: prev.warnings.filter(
                                    (w) => !w.toLowerCase().includes("gold code"),
                                  ),
                                }
                              : prev,
                          );
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
                  <Button variant="outline" onClick={() => setStep("import")}>
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
                      setStep("price");
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
              <aside className="border-b border-border/70 p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
                <h2 className="text-lg font-semibold tracking-tight">Jewellery Data</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  From verified extraction
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
                  onClick={() => setStep("verify")}
                >
                  Edit data
                </Button>
              </aside>

              <section className="border-b border-border/70 p-5 lg:col-span-4 lg:border-b-0 lg:border-r">
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
                              setSelection((prev) => ({
                                ...prev,
                                metals: toggleInArray(prev.metals, opt.id),
                              }))
                            }
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Purity</Label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {PURITY_OPTIONS.map((purity) => (
                        <label
                          key={purity}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                        >
                          <Checkbox
                            checked={selection.purities.includes(purity)}
                            onCheckedChange={() =>
                              setSelection((prev) => ({
                                ...prev,
                                purities: toggleInArray(prev.purities, purity),
                              }))
                            }
                          />
                          {purity}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Color</Label>
                    <div className="space-y-2">
                      {COLOR_OPTIONS.map((opt) => (
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
                      Both selected = separate price rows with their rates
                    </p>
                  </div>
                </div>
              </section>

              <section className="p-5 lg:col-span-5">
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
                          {purityRates.map((row) => (
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

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-champagne">
                      Diamond
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Shape">
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
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
                          className="flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
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

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="flex-1"
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
                        "Calculate"
                      )}
                    </Button>
                    <Button
                      className="flex-1"
                      size="lg"
                      variant="outline"
                      onClick={requestRecalculateAll}
                      disabled={validationIssues.length > 0 || isCalculating}
                    >
                      Recalculate All
                    </Button>
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
