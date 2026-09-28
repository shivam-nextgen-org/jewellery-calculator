import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildSampleWorkbookBuffer,
  jewelleryRowsToAoa,
  parseJewelleryWorkbook,
  SAMPLE_JEWELLERY_ROWS,
} from "@/lib/excel";
import { EXCEL_HEADERS } from "@/lib/excel/columns";

function workbookFromAoa(aoa: (string | number | null)[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Jewellery");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
  return new Uint8Array(out).buffer;
}

describe("parseJewelleryWorkbook", () => {
  it("parses the sample workbook round-trip", () => {
    const buffer = buildSampleWorkbookBuffer();
    const result = parseJewelleryWorkbook(buffer, {
      fileName: "sample.xlsx",
    });
    expect(result.fileErrors.filter((e) => !e.startsWith("Only"))).toEqual([]);
    expect(result.rows).toHaveLength(SAMPLE_JEWELLERY_ROWS.length);
    expect(result.meta.validRowCount).toBe(SAMPLE_JEWELLERY_ROWS.length);
    expect(result.rows[0].data.designNo).toBe("LR-0003");
    expect(result.rows[1].data.certificatePrice).toBe(500);
  });

  it("accepts camelCase header aliases", () => {
    const aoa = [
      ["designNo", "category", "goldCode", "netWeight", "diamondWeight"],
      ["A-1", "Ring", "G14Y", 2.5, 0.4],
    ];
    const result = parseJewelleryWorkbook(workbookFromAoa(aoa), {
      fileName: "alias.csv",
    });
    expect(result.fileErrors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data.designNo).toBe("A-1");
    expect(result.rows[0].data.netWeight).toBe(2.5);
  });

  it("skips empty rows", () => {
    const aoa = [
      EXCEL_HEADERS,
      ["B-1", "Ring", "G10Y", "Gold", "10K", "Yellow", 1, 1, 0.4, "", 0, "", "", "", 0, "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["B-2", "Pendant", "G18Y", "Gold", "18K", "Yellow", 2, 2, 1.5, "", 0.2, "Round", "Natural", "", 1, "", ""],
    ];
    const result = parseJewelleryWorkbook(workbookFromAoa(aoa), {
      fileName: "rows.xlsx",
    });
    expect(result.rows.map((r) => r.data.designNo)).toEqual(["B-1", "B-2"]);
  });

  it("marks rows missing Design No as invalid", () => {
    const aoa = [
      ["Design No", "Net Weight (g)"],
      ["", 1.2],
      ["OK-1", 2],
    ];
    const result = parseJewelleryWorkbook(workbookFromAoa(aoa), {
      fileName: "bad.xlsx",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].validation.valid).toBe(false);
    expect(result.rows[0].validation.errors[0]).toMatch(/Design No/i);
    expect(result.rows[1].validation.valid).toBe(true);
  });

  it("rejects files without Design No column", () => {
    const aoa = [
      ["Category", "Net Weight (g)"],
      ["Ring", 1],
    ];
    const result = parseJewelleryWorkbook(workbookFromAoa(aoa), {
      fileName: "missing.xlsx",
    });
    expect(result.rows).toHaveLength(0);
    expect(result.fileErrors.some((e) => e.includes("Design No"))).toBe(true);
  });

  it("rejects unsupported extensions via fileName", () => {
    const result = parseJewelleryWorkbook(new ArrayBuffer(8), {
      fileName: "photo.png",
    });
    expect(result.fileErrors[0]).toMatch(/Unsupported/i);
  });

  it("jewelleryRowsToAoa uses canonical headers", () => {
    const aoa = jewelleryRowsToAoa(SAMPLE_JEWELLERY_ROWS.slice(0, 1));
    expect(aoa[0]).toEqual(EXCEL_HEADERS);
    expect(aoa[1]?.[0]).toBe("LR-0003");
  });
});
