import * as XLSX from "xlsx";
import type { JewelleryExtractedData } from "@/types/jewellery";
import { jewelleryRowsToAoa } from "@/lib/excel/parse";

export const SAMPLE_JEWELLERY_ROWS: JewelleryExtractedData[] = [
  {
    designNo: "LR-0003",
    category: "Ladies Ring",
    goldCode: "G10Y",
    goldMetal: "Gold",
    goldPurity: "10K",
    goldColor: "Yellow Gold",
    grossWeight: 2.22,
    netWeight: 1.932,
    pureWeight: 0.83,
    size: "7",
    diamondWeight: 1.44,
    diamondShape: "Round",
    diamondType: "Natural",
    diamondPurity: "RND",
    diamondPieces: 28,
    certified: "Natural",
    certificatePrice: null,
  },
  {
    designNo: "ER-0142",
    category: "Earrings",
    goldCode: "G14W",
    goldMetal: "Gold",
    goldPurity: "14K",
    goldColor: "White Gold",
    grossWeight: 3.1,
    netWeight: 2.85,
    pureWeight: 1.66,
    size: "",
    diamondWeight: 0.92,
    diamondShape: "Round",
    diamondType: "Lab Grown",
    diamondPurity: "",
    diamondPieces: 16,
    certified: "IGI",
    certificatePrice: 500,
  },
  {
    designNo: "PN-0088",
    category: "Pendant",
    goldCode: "G18Y",
    goldMetal: "Gold",
    goldPurity: "18K",
    goldColor: "Yellow Gold",
    grossWeight: 4.5,
    netWeight: 4.2,
    pureWeight: 3.15,
    size: "",
    diamondWeight: 0.5,
    diamondShape: "Pear",
    diamondType: "Natural",
    diamondPurity: "",
    diamondPieces: 1,
    certified: "",
    certificatePrice: null,
  },
];

export const SAMPLE_EXCEL_FILENAME = "jewellery-import-template.xlsx";

/** Build an .xlsx ArrayBuffer with canonical headers + sample rows. */
export function buildSampleWorkbookBuffer(
  rows: JewelleryExtractedData[] = SAMPLE_JEWELLERY_ROWS,
): ArrayBuffer {
  const aoa = jewelleryRowsToAoa(rows);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Jewellery");
  const out = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as number[];
  return new Uint8Array(out).buffer;
}

/** Trigger a browser download of the sample template. */
export function downloadSampleExcel(
  fileName: string = SAMPLE_EXCEL_FILENAME,
): void {
  if (typeof window === "undefined") return;
  const buffer = buildSampleWorkbookBuffer();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
