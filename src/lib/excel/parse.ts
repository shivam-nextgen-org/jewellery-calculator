import * as XLSX from "xlsx";
import type { JewelleryExtractedData } from "@/types/jewellery";
import {
  EXCEL_COLUMNS,
  EXCEL_MAX_ROWS,
  resolveColumnKey,
} from "@/lib/excel/columns";
import {
  isEmptyJewelleryRow,
  normalizeJewelleryRow,
} from "@/lib/excel/normalize-row";
import {
  validateJewelleryRow,
  type ExcelRowValidation,
} from "@/lib/excel/validate-row";

export type ParsedExcelRow = {
  /** 1-based spreadsheet row number (header is row 1). */
  sheetRow: number;
  data: JewelleryExtractedData;
  validation: ExcelRowValidation;
};

export type ParseJewelleryWorkbookResult = {
  rows: ParsedExcelRow[];
  /** File-level errors that block using the workbook. */
  fileErrors: string[];
  meta: {
    sheetName: string;
    headerKeys: (keyof JewelleryExtractedData)[];
    totalDataRows: number;
    validRowCount: number;
  };
};

function isAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv")
  );
}

/**
 * Parse an ArrayBuffer from an uploaded spreadsheet into jewellery rows.
 */
export function parseJewelleryWorkbook(
  buffer: ArrayBuffer,
  options?: { fileName?: string },
): ParseJewelleryWorkbookResult {
  const fileErrors: string[] = [];
  const fileName = options?.fileName ?? "";

  if (fileName && !isAllowedExtension(fileName)) {
    return {
      rows: [],
      fileErrors: ["Unsupported file type. Upload .xlsx, .xls, or .csv."],
      meta: {
        sheetName: "",
        headerKeys: [],
        totalDataRows: 0,
        validRowCount: 0,
      },
    };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  } catch {
    return {
      rows: [],
      fileErrors: ["Could not read the file. Check it is a valid Excel/CSV."],
      meta: {
        sheetName: "",
        headerKeys: [],
        totalDataRows: 0,
        validRowCount: 0,
      },
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      fileErrors: ["Workbook has no sheets."],
      meta: {
        sheetName: "",
        headerKeys: [],
        totalDataRows: 0,
        validRowCount: 0,
      },
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
    sheet,
    {
      header: 1,
      defval: "",
      raw: true,
      blankrows: false,
    },
  );

  if (!matrix.length) {
    return {
      rows: [],
      fileErrors: ["Sheet is empty."],
      meta: {
        sheetName,
        headerKeys: [],
        totalDataRows: 0,
        validRowCount: 0,
      },
    };
  }

  const headerRow = matrix[0] ?? [];
  const columnMap: {
    index: number;
    key: keyof JewelleryExtractedData;
  }[] = [];
  const seen = new Set<keyof JewelleryExtractedData>();

  headerRow.forEach((cell, index) => {
    const key = resolveColumnKey(String(cell ?? ""));
    if (!key || seen.has(key)) return;
    seen.add(key);
    columnMap.push({ index, key });
  });

  if (!columnMap.some((c) => c.key === "designNo")) {
    fileErrors.push(
      'Missing required column "Design No". Download the sample Excel for the correct headers.',
    );
  }

  if (columnMap.length === 0) {
    fileErrors.push(
      "No recognised column headers. Download the sample Excel and match those headers.",
    );
  }

  if (fileErrors.length > 0) {
    return {
      rows: [],
      fileErrors,
      meta: {
        sheetName,
        headerKeys: columnMap.map((c) => c.key),
        totalDataRows: 0,
        validRowCount: 0,
      },
    };
  }

  const rows: ParsedExcelRow[] = [];
  let truncated = false;

  for (let r = 1; r < matrix.length; r++) {
    if (rows.length >= EXCEL_MAX_ROWS) {
      truncated = true;
      break;
    }

    const line = matrix[r] ?? [];
    const raw: Partial<Record<keyof JewelleryExtractedData, unknown>> = {};
    for (const { index, key } of columnMap) {
      raw[key] = line[index];
    }

    const { data, invalidNumberKeys } = normalizeJewelleryRow(raw);
    if (isEmptyJewelleryRow(data)) continue;

    const validation = validateJewelleryRow(data, { invalidNumberKeys });
    rows.push({
      sheetRow: r + 1,
      data,
      validation,
    });
  }

  if (rows.length === 0) {
    fileErrors.push("No data rows found under the header.");
  } else if (truncated) {
    fileErrors.push(
      `Only the first ${EXCEL_MAX_ROWS} data rows were imported.`,
    );
  }

  return {
    rows,
    fileErrors,
    meta: {
      sheetName,
      headerKeys: columnMap.map((c) => c.key),
      totalDataRows: rows.length,
      validRowCount: rows.filter((r) => r.validation.valid).length,
    },
  };
}

/** Build AOA (array-of-arrays) for writing a workbook with canonical headers. */
export function jewelleryRowsToAoa(
  rows: JewelleryExtractedData[],
): (string | number | null)[][] {
  const headers = EXCEL_COLUMNS.map((c) => c.header);
  const body = rows.map((row) =>
    EXCEL_COLUMNS.map((c) => {
      const v = row[c.key];
      if (v == null) return "";
      return v as string | number;
    }),
  );
  return [headers, ...body];
}
