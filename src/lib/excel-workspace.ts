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
import type {
  DiamondTypeOption,
  GoldPurityOption,
  JewelleryExtractedData,
  PricingFormState,
  VariationSelection,
} from "@/types/jewellery";

/** Pre-select metals/purities/diamond types from a sheet row. */
export function selectionFromExtractedRow(
  data: JewelleryExtractedData,
  prev: VariationSelection,
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

  if (parsed.ok) {
    const hints = variationHintsFromGoldCode(parsed);
    return {
      metals: hints.metals,
      purities: Array.from(
        new Set([...hints.purities, "14K", "18K"]),
      ) as GoldPurityOption[],
      colors: ["yellow", "white", "rose"],
      diamondTypes: preferredDia,
    };
  }

  return {
    ...prev,
    diamondTypes: preferredDia,
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
