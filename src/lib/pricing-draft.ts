import type { VariationOverrides } from "@/lib/pricing-engine";
import type {
  JewelleryExtractedData,
  GoldPurityOption,
  PricingFormState,
  PricingStep,
  VariationSelection,
} from "@/types/jewellery";

export const PRICING_DRAFT_KEY = "atelier.pricing.draft.v1";
/** Excel rows stored separately so large sheets don't blow the main draft quota. */
export const PRICING_EXCEL_ROWS_KEY = "atelier.pricing.excel-rows.v1";

export type PricingEntryMode = "excel" | "manual";

export type StoredExcelRow = {
  sheetRow: number;
  data: JewelleryExtractedData;
};

export interface PricingDraft {
  version: 1 | 2;
  extracted: JewelleryExtractedData;
  pricing: PricingFormState;
  selection: VariationSelection;
  purityPercentages: Record<GoldPurityOption, number>;
  overridesByVariationId: Record<string, VariationOverrides>;
  /** @deprecated Prefer excelFileName; kept for resume compatibility. */
  imageName: string | null;
  ocrImportId: string | null;
  step: PricingStep;
  calculatedAt: string | null;
  /**
   * Set to true when the results page sends the user back to the workspace.
   * Also restored when an active excel/manual session exists (see workspace).
   */
  resume?: boolean;
  entryMode?: PricingEntryMode;
  excelFileName?: string | null;
  /**
   * Optional inline rows (small sheets). Large sheets use
   * {@link PRICING_EXCEL_ROWS_KEY} instead — prefer loadExcelRows().
   */
  excelRows?: JewelleryExtractedData[] | StoredExcelRow[];
  selectedRowIndex?: number | null;
}

export function saveExcelRows(rows: StoredExcelRow[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PRICING_EXCEL_ROWS_KEY, JSON.stringify(rows));
  } catch {
    // quota — leave previous rows; caller still has in-memory copy
  }
}

export function loadExcelRows(): StoredExcelRow[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PRICING_EXCEL_ROWS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredExcelRow[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearExcelRows(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PRICING_EXCEL_ROWS_KEY);
  } catch {
    // ignore
  }
}

function normalizeStoredRows(
  rows: JewelleryExtractedData[] | StoredExcelRow[] | undefined,
): StoredExcelRow[] {
  if (!rows?.length) return [];
  return rows.map((row, i) => {
    if (row && typeof row === "object" && "data" in row && "sheetRow" in row) {
      return row as StoredExcelRow;
    }
    return {
      sheetRow: i + 2,
      data: row as JewelleryExtractedData,
    };
  });
}

export function savePricingDraft(draft: PricingDraft): void {
  if (typeof window === "undefined") return;

  const storedRows = normalizeStoredRows(draft.excelRows);
  if (storedRows.length > 0) {
    saveExcelRows(storedRows);
  }

  // Keep main draft lean — excel rows live in the dedicated key.
  const lean: PricingDraft = {
    ...draft,
    excelRows: undefined,
  };

  try {
    sessionStorage.setItem(PRICING_DRAFT_KEY, JSON.stringify(lean));
  } catch {
    try {
      const slim: PricingDraft = {
        ...lean,
        overridesByVariationId: {},
      };
      sessionStorage.setItem(PRICING_DRAFT_KEY, JSON.stringify(slim));
    } catch {
      // ignore
    }
  }
}

export function loadPricingDraft(): PricingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PRICING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PricingDraft;
    if (
      (parsed?.version !== 1 && parsed?.version !== 2) ||
      !parsed.extracted ||
      !parsed.pricing
    ) {
      return null;
    }

    const external = loadExcelRows();
    if (external?.length) {
      parsed.excelRows = external;
    } else if (parsed.excelRows?.length) {
      parsed.excelRows = normalizeStoredRows(parsed.excelRows);
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
  clearExcelRows();
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

/** True when the draft has an in-progress excel or manual pricing session. */
export function draftHasActiveSession(draft: PricingDraft | null): boolean {
  if (!draft) return false;
  if (draft.resume) return true;
  if (draft.entryMode === "manual" && draft.step !== "import") return true;
  const rows = draft.excelRows;
  if (rows && rows.length > 0) return true;
  if (draft.excelFileName) return true;
  if (draft.calculatedAt) return true;
  return false;
}
