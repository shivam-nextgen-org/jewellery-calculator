import type { JewelleryExtractedData } from "@/types/jewellery";

export type ExcelRowValidation = {
  /** Hard errors — row cannot be selected for pricing. */
  errors: string[];
  /** Soft warnings — row can still be used. */
  warnings: string[];
  valid: boolean;
};

export function validateJewelleryRow(
  row: JewelleryExtractedData,
  options?: {
    invalidNumberKeys?: (keyof JewelleryExtractedData)[];
  },
): ExcelRowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.designNo.trim()) {
    errors.push("Design No is required");
  }

  for (const key of options?.invalidNumberKeys ?? []) {
    errors.push(`Invalid number in ${String(key)}`);
  }

  if (row.netWeight < 0 || row.grossWeight < 0 || row.diamondWeight < 0) {
    errors.push("Weights cannot be negative");
  }

  if (row.grossWeight > 0 && row.netWeight > row.grossWeight) {
    warnings.push("Net weight is greater than gross weight");
  }

  if (!row.goldCode.trim() && !row.goldPurity.trim()) {
    warnings.push("Gold code / purity missing — set before pricing");
  }

  if (row.diamondWeight > 0 && !row.diamondType.trim()) {
    warnings.push("Diamond type missing");
  }

  return {
    errors,
    warnings,
    valid: errors.length === 0,
  };
}
