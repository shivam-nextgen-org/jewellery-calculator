import type { JewelleryExtractedData } from "@/types/jewellery";

/** Canonical spreadsheet headers (display names for sample + docs). */
export const EXCEL_COLUMNS: {
  key: keyof JewelleryExtractedData;
  header: string;
  aliases: string[];
}[] = [
  {
    key: "designNo",
    header: "Design No",
    aliases: ["design no", "designno", "design number", "design #"],
  },
  {
    key: "category",
    header: "Category",
    aliases: ["cat", "product category"],
  },
  {
    key: "goldCode",
    header: "Gold Code",
    aliases: ["goldcode", "code"],
  },
  {
    key: "goldMetal",
    header: "Gold",
    aliases: ["metal", "gold metal", "goldmetal"],
  },
  {
    key: "goldPurity",
    header: "Purity",
    aliases: ["gold purity", "goldpurity", "kt", "karat"],
  },
  {
    key: "goldColor",
    header: "Color",
    aliases: ["colour", "gold color", "gold colour", "goldcolor"],
  },
  {
    key: "grossWeight",
    header: "Gross Weight (g)",
    aliases: ["gross weight", "grossweight", "gross wt", "gross"],
  },
  {
    key: "netWeight",
    header: "Net Weight (g)",
    aliases: ["net weight", "netweight", "net wt", "net"],
  },
  {
    key: "pureWeight",
    header: "Pure Weight (g)",
    aliases: ["pure weight", "pureweight", "pure wt", "pure"],
  },
  {
    key: "size",
    header: "Size",
    aliases: ["sz"],
  },
  {
    key: "diamondWeight",
    header: "Diamond Weight (CT)",
    aliases: [
      "diamond weight",
      "diamondweight",
      "dia weight",
      "dia wt",
      "ct",
      "carat",
    ],
  },
  {
    key: "diamondShape",
    header: "Diamond Shape",
    aliases: ["diamondshape", "dia shape", "shape"],
  },
  {
    key: "diamondType",
    header: "Diamond Type",
    aliases: ["diamondtype", "dia type", "type"],
  },
  {
    key: "diamondPurity",
    header: "Diamond Purity",
    aliases: ["diamondpurity", "dia purity"],
  },
  {
    key: "diamondPieces",
    header: "Diamond Pieces",
    aliases: ["diamondpieces", "dia pieces", "pieces", "pcs"],
  },
  {
    key: "certified",
    header: "Certified",
    aliases: ["certification", "certificate"],
  },
  {
    key: "certificatePrice",
    header: "Certificate Price",
    aliases: [
      "certificate price",
      "certificateprice",
      "cert price",
      "certificate price (₹)",
      "certificate price (rs)",
    ],
  },
];

export const EXCEL_HEADERS = EXCEL_COLUMNS.map((c) => c.header);

/** Max rows accepted from one workbook (production guard). */
export const EXCEL_MAX_ROWS = 500;

/** Max upload size in bytes (5 MB). */
export const EXCEL_MAX_BYTES = 5 * 1024 * 1024;

export const EXCEL_ACCEPT =
  ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[₹$]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .trim();
}

/** Map a spreadsheet header cell to a JewelleryExtractedData key. */
export function resolveColumnKey(
  header: string,
): keyof JewelleryExtractedData | null {
  const n = normalizeHeader(header);
  if (!n) return null;

  for (const col of EXCEL_COLUMNS) {
    if (normalizeHeader(col.header) === n) return col.key;
    if (normalizeHeader(col.key) === n) return col.key;
    if (col.aliases.some((a) => normalizeHeader(a) === n)) return col.key;
  }
  return null;
}
