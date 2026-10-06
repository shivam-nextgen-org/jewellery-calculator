/**
 * Thin re-exports + workspace helpers for Excel import UI.
 */
export {
  EXCEL_ACCEPT,
  EXCEL_MAX_BYTES,
  downloadSampleExcel,
  parseJewelleryWorkbook,
  validateJewelleryRow,
  type ParsedExcelRow,
} from "@/lib/excel";

import { parseGoldCode, variationHintsFromGoldCode } from "@/lib/gold-code";
import {
  defaultMetalSelection,
  migrateVariationSelection,
  type StoneGradeSourceMap,
} from "@/lib/variation-selection";
import type {
  DiamondTypeOption,
  JewelleryExtractedData,
  PricingFormState,
  VariationSelection,
} from "@/types/jewellery";

/** Pre-select metals/purities/colours/stone types from a sheet row. */
export function selectionFromExtractedRow(
  data: JewelleryExtractedData,
  prev: VariationSelection,
  gradeSources?: StoneGradeSourceMap,
): VariationSelection {
  const parsed = parseGoldCode(data.goldCode);
  const sheetDia = data.diamondType.toLowerCase();
  const preferredDia: DiamondTypeOption[] = sheetDia.includes("moissan")
    ? ["moissanite", "natural", "lab-grown"]
    : sheetDia.includes("lab")
      ? ["lab-grown", "natural"]
      : sheetDia.includes("natural")
        ? ["natural", "lab-grown"]
        : prev.diamondTypes.length
          ? prev.diamondTypes
          : ["natural", "lab-grown"];

  const base: VariationSelection = {
    ...migrateVariationSelection(prev, gradeSources),
    diamondTypes: preferredDia,
  };

  if (!parsed.ok) return base;

  // Widen the sheet's own code with that metal's usual purities / colours —
  // never gold colours for a silver row.
  const hints = variationHintsFromGoldCode(parsed);
  const metalDefaults = defaultMetalSelection(hints.metals[0]);
  return {
    ...base,
    metals: hints.metals,
    purities: Array.from(
      new Set([...hints.purities, ...metalDefaults.purities]),
    ),
    colors: Array.from(new Set([...hints.colors, ...metalDefaults.colors])),
  };
}

export function diamondShapeFromExtracted(
  data: JewelleryExtractedData,
  current: PricingFormState["diamondShape"],
): PricingFormState["diamondShape"] {
  const shapeLower = data.diamondShape.toLowerCase();
  if (shapeLower.includes("pear")) return "pear";
  if (shapeLower.includes("pri") || shapeLower.includes("princess")) {
    return "princess";
  }
  if (shapeLower.includes("oval")) return "oval";
  if (shapeLower.includes("marquise")) return "marquise";
  if (shapeLower.includes("emerald")) return "emerald";
  if (shapeLower.includes("cushion")) return "cushion";
  if (shapeLower.includes("round")) return "round";
  return current;
}
