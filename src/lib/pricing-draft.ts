import type { VariationOverrides } from "@/lib/pricing-engine";
import type {
  JewelleryExtractedData,
  GoldPurityOption,
  PricingFormState,
  PricingStep,
  VariationSelection,
} from "@/types/jewellery";

export const PRICING_DRAFT_KEY = "atelier.pricing.draft.v1";

export interface PricingDraft {
  version: 1;
  extracted: JewelleryExtractedData;
  pricing: PricingFormState;
  selection: VariationSelection;
  purityPercentages: Record<GoldPurityOption, number>;
  overridesByVariationId: Record<string, VariationOverrides>;
  imageName: string | null;
  ocrImportId: string | null;
  step: PricingStep;
  calculatedAt: string | null;
  /**
   * Set to true when the results page sends the user back to the workspace to
   * edit (Back to pricing / Edit Data / Edit Rates). The workspace restores the
   * draft only in this case; otherwise it starts fresh. The workspace clears
   * this flag after consuming it.
   */
  resume?: boolean;
}

export function savePricingDraft(draft: PricingDraft): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PRICING_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // quota / private mode — ignore
  }
}

export function loadPricingDraft(): PricingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PRICING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PricingDraft;
    if (parsed?.version !== 1 || !parsed.extracted || !parsed.pricing) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPricingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PRICING_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function updatePricingDraft(
  patch: Partial<PricingDraft>,
): PricingDraft | null {
  const current = loadPricingDraft();
  if (!current) return null;
  const next = { ...current, ...patch };
  savePricingDraft(next);
  return next;
}
