import type { JewelleryExtractedData } from "@/types/jewellery";

export const BLANK_JEWELLERY_ROW: JewelleryExtractedData = {
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

const NUMBER_KEYS: (keyof JewelleryExtractedData)[] = [
  "grossWeight",
  "netWeight",
  "pureWeight",
  "diamondWeight",
  "diamondPieces",
];

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

/**
 * Parse a cell into a finite number. Empty / blank → 0.
 * Returns NaN when the cell has text that is not numeric.
 */
export function parseNumericCell(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  const raw = String(value).trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, "").replace(/₹/g, "").replace(/\s/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Returns `{ ok: true, value }` or `{ ok: false }` when the cell is non-numeric. */
export function parseOptionalMoney(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value === "string" && !value.trim()) {
    return { ok: true, value: null };
  }
  const n = parseNumericCell(value);
  if (Number.isNaN(n)) return { ok: false };
  return { ok: true, value: n };
}

export type NormalizeRowResult = {
  data: JewelleryExtractedData;
  /** Keys that had non-numeric values where a number was expected. */
  invalidNumberKeys: (keyof JewelleryExtractedData)[];
};

/**
 * Coerce a raw column→value map into JewelleryExtractedData.
 */
export function normalizeJewelleryRow(
  raw: Partial<Record<keyof JewelleryExtractedData, unknown>>,
): NormalizeRowResult {
  const invalidNumberKeys: (keyof JewelleryExtractedData)[] = [];
  const data: JewelleryExtractedData = { ...BLANK_JEWELLERY_ROW };

  data.designNo = asString(raw.designNo);
  data.category = asString(raw.category);
  data.goldCode = asString(raw.goldCode);
  data.goldMetal = asString(raw.goldMetal);
  data.goldPurity = asString(raw.goldPurity);
  data.goldColor = asString(raw.goldColor);
  data.size = asString(raw.size);
  data.diamondShape = asString(raw.diamondShape);
  data.diamondType = asString(raw.diamondType);
  data.diamondPurity = asString(raw.diamondPurity);
  data.certified = asString(raw.certified);

  for (const key of NUMBER_KEYS) {
    const n = parseNumericCell(raw[key]);
    if (Number.isNaN(n)) {
      invalidNumberKeys.push(key);
      data[key] = 0 as never;
    } else {
      data[key] = n as never;
    }
  }

  const cert = parseOptionalMoney(raw.certificatePrice);
  if (!cert.ok) {
    invalidNumberKeys.push("certificatePrice");
    data.certificatePrice = null;
  } else {
    data.certificatePrice = cert.value;
  }

  return { data, invalidNumberKeys };
}

/** True when every string field is empty and every numeric field is 0/null. */
export function isEmptyJewelleryRow(row: JewelleryExtractedData): boolean {
  return (
    !row.designNo &&
    !row.category &&
    !row.goldCode &&
    !row.goldMetal &&
    !row.goldPurity &&
    !row.goldColor &&
    !row.size &&
    !row.diamondShape &&
    !row.diamondType &&
    !row.diamondPurity &&
    !row.certified &&
    row.grossWeight === 0 &&
    row.netWeight === 0 &&
    row.pureWeight === 0 &&
    row.diamondWeight === 0 &&
    row.diamondPieces === 0 &&
    row.certificatePrice == null
  );
}
