import type { OcrRawFieldMap } from "./types";
import { buildMetalCodeFromParts } from "@/lib/gold-code";

export interface ParsedSheetText {
  fields: OcrRawFieldMap;
  warnings: string[];
}

const CATEGORY_KEYWORDS: { match: RegExp; label: string }[] = [
  { match: /ladies?\s*ring|lady\s*ring/i, label: "Ladies Ring" },
  { match: /gents?\s*ring|men'?s?\s*ring/i, label: "Gents Ring" },
  { match: /ear\s*rings?|earrings?/i, label: "Earrings" },
  { match: /pendant/i, label: "Pendant" },
  { match: /bracelet/i, label: "Bracelet" },
  { match: /necklace|\bchain\b/i, label: "Necklace" },
  { match: /bangle/i, label: "Bangle" },
  { match: /nose\s*pin|\bnath\b/i, label: "Nose Pin" },
];

const SHAPE_KEYWORDS: { match: RegExp; label: string }[] = [
  { match: /\brd\b|\bround\b|\brnd\b/i, label: "Round" },
  { match: /\bpri\b|\bprincess\b/i, label: "Princess" },
  { match: /\boval\b/i, label: "Oval" },
  { match: /\bpe\b|\bpear\b/i, label: "Pear" },
  { match: /\bmarquise\b|\bmq\b/i, label: "Marquise" },
  { match: /\bemerald\b/i, label: "Emerald" },
  { match: /\bcushion\b/i, label: "Cushion" },
];

const DESIGN_STOPWORDS = new Set([
  "GROSS",
  "NET",
  "PURE",
  "SIZE",
  "GOLD",
  "QTY",
  "DIA",
  "WT",
  "CERT",
  "CERTI",
  "PRICE",
  "LAB",
  "NATURAL",
  "CATEGORY",
  "DESIGN",
  "NAME",
  "DIAMOND",
  "PCS",
  "PURITY",
  "GLOW", // common OCR misread of Gross
]);

/**
 * Convert messy OCR text from a jewellery design sheet into structured fields.
 * Final sheet columns (Metal Mix is ignored):
 * Design | Category | Metal | Metal Purity | Metal Color | Metal Mix(ignore) |
 * Gross | Net | Pure | Size | Dia Wt | … | Diamond | Dia pcs
 */
export function parseJewellerySheetText(rawText: string): ParsedSheetText {
  const warnings: string[] = [];
  // Strip Metal Mix tokens like G10RG so they don't confuse gold-code detection
  const text = normalizeOcrNoise(stripMetalMixNoise(rawText));
  const compact = text.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  const fields: OcrRawFieldMap = {};

  // 0) Final sheet: Metal / Metal Purity / Metal Color (preferred over Metal Mix)
  const sheetParts = extractMetalPartsFromSheet(text);
  if (sheetParts) {
    Object.assign(fields, sheetParts);
  }

  // 1) Gold / silver code — prefer built from sheet parts
  let gold =
    (fields.goldCode as string | undefined) ?? findGoldCode(text);
  if (gold) {
    fields.goldCode = gold;
  } else {
    warnings.push("Gold code not detected in OCR text");
  }

  // 2) Extract from the data row that contains the gold code (best signal)
  const rowParsed = extractFromGoldCodeRow(text, gold ?? null);
  if (rowParsed) {
    for (const [k, v] of Object.entries(rowParsed)) {
      if (fields[k] == null || fields[k] === "") fields[k] = v;
    }
  }

  // 2b) Final-sheet flat row (Metal / Purity / Color) — preferred when present
  if (sheetParts?.goldMetal) {
    const finalRow = extractFromFinalSheetFlatRow(text);
    if (finalRow) {
      Object.assign(fields, finalRow);
    }
  }

  // 2c) Design-row fallback when gold code OCR failed
  if (!fields.netWeight || !fields.grossWeight) {
    const designRow = extractFromDesignRow(
      text,
      fields.designNo as string | undefined,
    );
    if (designRow) {
      for (const [k, v] of Object.entries(designRow)) {
        if (fields[k] == null || fields[k] === "") fields[k] = v;
      }
    }
  }

  // 2d) Final-sheet flat row fallback
  if (!fields.netWeight || !fields.grossWeight || !fields.designNo) {
    const finalRow = extractFromFinalSheetFlatRow(text);
    if (finalRow) {
      for (const [k, v] of Object.entries(finalRow)) {
        if (fields[k] == null || fields[k] === "") fields[k] = v;
      }
    }
  }

  // 2e) Columnar OCR (label / value on alternating lines)
  if (
    !fields.netWeight ||
    !fields.grossWeight ||
    !fields.designNo ||
    !fields.goldCode
  ) {
    const columnar = extractFromLabelValuePairs(text);
    for (const [k, v] of Object.entries(columnar)) {
      if (fields[k] == null || fields[k] === "") fields[k] = v;
    }
  }

  // Re-build gold code from metal parts if still missing
  if (!fields.goldCode && (fields.goldMetal || fields.goldPurity)) {
    const built = buildCodeFromFieldParts(fields);
    if (built) {
      fields.goldCode = built;
      gold = built;
      const idx = warnings.indexOf("Gold code not detected in OCR text");
      if (idx >= 0) warnings.splice(idx, 1);
    }
  }

  // 3) Category keywords
  for (const item of CATEGORY_KEYWORDS) {
    if (item.match.test(compact)) {
      fields.category = item.label;
      break;
    }
  }

  // 4) Design number (prefer row extraction; fallback scanners)
  if (!fields.designNo) {
    const design = findDesignNo(text, gold ?? (fields.goldCode as string) ?? null);
    if (design) fields.designNo = design;
    else warnings.push("Design number not detected");
  }

  // 5) Label-based fill for remaining gaps
  assignIfMissing(fields, "grossWeight", () =>
    matchNumberNear(text, ["gross\\s*wt\\.?", "gross\\s*weight", "gross"]),
  );
  assignIfMissing(fields, "netWeight", () =>
    matchNumberNear(text, ["net\\s*wt\\.?", "net\\s*weight", "\\bnet\\b"]),
  );
  assignIfMissing(fields, "pureWeight", () =>
    matchNumberNear(text, ["pure\\s*wt\\.?", "pure\\s*weight", "\\bpure\\b"]),
  );
  assignIfMissing(fields, "diamondWeight", () =>
    matchNumberNear(text, [
      "dia\\.?\\s*wt\\.?",
      "diamond\\s*wt\\.?",
      "diamond\\s*weight",
      "dia\\s*weight",
    ]),
  );

  if (!fields.size) {
    const sizeLabeled = matchLabeled(text, ["size"]);
    if (sizeLabeled) {
      const sizeNum = sizeLabeled.match(/[\d.]+/);
      fields.size = sizeNum ? sizeNum[0] : sizeLabeled;
    }
  }

  assignIfMissing(fields, "diamondPieces", () => {
    const pcs = matchNumberNear(text, [
      "dia\\.?\\s*pcs\\.?",
      "diamond\\s*pcs\\.?",
      "dia\\.?\\s*pieces?",
    ]);
    return pcs != null ? Math.round(pcs) : null;
  });

  // Certificate price (large integer often)
  assignIfMissing(fields, "certificatePrice", () =>
    matchNumberNear(text, ["certi\\.?\\s*price", "certificate\\s*price", "cert\\s*price"]),
  );

  if (/\blab\b|\blab[\s-]*grown\b/i.test(compact)) {
    fields.diamondType = "Lab Grown";
  } else if (/\bnatural\b/i.test(compact)) {
    fields.diamondType = "Natural";
  }

  for (const item of SHAPE_KEYWORDS) {
    if (item.match.test(compact)) {
      fields.diamondShape = item.label;
      break;
    }
  }

  if (!fields.certified) {
    if (/\blab\b/i.test(compact)) fields.certified = "Lab";
    else if (/\bnatural\b/i.test(compact)) fields.certified = "Natural";
  }

  // Clean false design numbers like GLOW-338
  if (fields.designNo && isBadDesignNo(String(fields.designNo))) {
    delete fields.designNo;
    const retry = findDesignNo(text, (fields.goldCode as string) ?? gold);
    if (retry) fields.designNo = retry;
    else warnings.push("Design number not detected");
  }

  // Prefer small carat-like dia wt when a large "pure-like" value was picked
  if (
    fields.diamondWeight != null &&
    Number(fields.diamondWeight) >= 3 &&
    fields.pureWeight != null &&
    Math.abs(Number(fields.diamondWeight) - Number(fields.pureWeight)) < 0.05
  ) {
    // likely confused pure into dia — leave for label pass / design row
  }

  if (fields.netWeight == null || Number(fields.netWeight) <= 0) {
    warnings.push("Net weight not detected");
  }
  if (fields.diamondWeight == null || Number(fields.diamondWeight) < 0) {
    warnings.push("Diamond weight not detected");
  }

  // Drop low-confidence noise warning only when we recovered the critical fields
  if (fields.goldCode && fields.netWeight && Number(fields.netWeight) > 0) {
    const idx = warnings.indexOf("Gold code not detected in OCR text");
    if (idx >= 0) warnings.splice(idx, 1);
    const idx2 = warnings.indexOf("Net weight not detected");
    if (idx2 >= 0) warnings.splice(idx2, 1);
  }

  return { fields, warnings };
}

/** Remove Metal Mix codes (G10RG, G14YG…) — sheet has separate Metal/Purity/Color */
function stripMetalMixNoise(raw: string): string {
  return raw
    .replace(/\bmetal\s*mix\b/gi, " ")
    .replace(/\bG\d{1,2}RG\b/gi, " ")
    .replace(/\bG\d{1,2}YG\b/gi, " ")
    .replace(/\bG\d{1,2}WG\b/gi, " ");
}

function buildCodeFromFieldParts(fields: OcrRawFieldMap): string | null {
  const built = buildMetalCodeFromParts(
    fields.goldMetal as string | undefined,
    fields.goldPurity as string | number | undefined,
    fields.goldColor as string | undefined,
  );
  return built.ok ? built.normalizedCode : null;
}

/**
 * Prefer explicit Metal / Metal Purity / Metal Color columns from the final sheet.
 */
function extractMetalPartsFromSheet(text: string): OcrRawFieldMap | null {
  const fields: OcrRawFieldMap = {};
  const lines = text
    .split("\n")
    .map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Label/value pairs
  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i];
    const value = lines[i + 1];
    if (/^metal\s*mix$/i.test(label)) continue; // ignore
    if (/^metal\s*purity$/i.test(label) || /^metal\s*pur\.?$/i.test(label)) {
      fields.goldPurity = value.replace(/[^\d.K]/gi, "") || value;
      continue;
    }
    if (/^metal\s*color$/i.test(label)) {
      fields.goldColor = value;
      continue;
    }
    if (/^metal$/i.test(label) && !/mix|purity|color/i.test(label)) {
      if (/^(gold|silver|platinum)$/i.test(value)) fields.goldMetal = value;
      continue;
    }
  }

  // Flat / same-line patterns
  const metalM = text.match(
    /\bmetal\b(?!\s*(?:mix|purity|color))[:\s|-]*\b(Gold|Silver|Platinum)\b/i,
  );
  if (metalM && !fields.goldMetal) fields.goldMetal = metalM[1];

  const purityM = text.match(
    /\bmetal\s*purity\b[:\s|-]*([0-9]{1,3}K?|\d{3})/i,
  );
  if (purityM && !fields.goldPurity) fields.goldPurity = purityM[1];

  const colorM = text.match(
    /\bmetal\s*color\b[:\s|-]*((?:Rose|Yellow|White)\s*Gold|Rose|Yellow|White)/i,
  );
  if (colorM && !fields.goldColor) fields.goldColor = colorM[1];

  // Row style: "Gold 10 Rose Gold" after category
  if (!fields.goldMetal || !fields.goldPurity || !fields.goldColor) {
    const row = text.match(
      /\b(Gold|Silver)\s+(\d{1,2}|925|999|958)\s+((?:Rose|Yellow|White)\s*Gold)/i,
    );
    if (row) {
      fields.goldMetal = fields.goldMetal || row[1];
      fields.goldPurity = fields.goldPurity || row[2];
      fields.goldColor = fields.goldColor || row[3];
    }
  }

  if (!fields.goldMetal && !fields.goldPurity && !fields.goldColor) {
    return null;
  }

  const code = buildCodeFromFieldParts(fields);
  if (code) fields.goldCode = code;

  // Normalize display purity for gold karat
  if (fields.goldPurity && fields.goldMetal) {
    const p = String(fields.goldPurity).toUpperCase();
    if (/^gol/i.test(String(fields.goldMetal)) && /^\d{1,2}$/.test(p)) {
      fields.goldPurity = `${p}K`;
    }
  }

  return fields;
}

/**
 * Flat final-sheet data row without relying on Metal Mix code:
 * MSLR-09 LADIES RING Gold 10 Rose Gold 3.48 3.333 1.45 7 0.735 … Lab 54
 */
function extractFromFinalSheetFlatRow(text: string): OcrRawFieldMap | null {
  const flat = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const design = findDesignNo(flat, null);
  if (!design) return null;

  const parts = extractMetalPartsFromSheet(flat);
  const goldCode = (parts?.goldCode as string | undefined) ?? findGoldCode(flat);

  // Cut from after color / metal block to numbers
  let after = flat;
  const colorIdx = flat.search(/(?:Rose|Yellow|White)\s*Gold/i);
  if (colorIdx >= 0) {
    const m = flat.slice(colorIdx).match(/^(?:Rose|Yellow|White)\s*Gold/i);
    after = flat.slice(colorIdx + (m?.[0].length ?? 0));
  } else if (goldCode) {
    const gIdx = flat.toUpperCase().indexOf(goldCode);
    if (gIdx >= 0) after = flat.slice(gIdx + goldCode.length);
  }

  // Drop leftover mix codes and metal/purity words so "10" isn't taken as gross
  after = after
    .replace(/\bG\d{1,2}[A-Z]{1,2}\b/gi, " ")
    .replace(/\b(?:Gold|Silver|Platinum)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Prefer decimal weights (gross/net) as first numbers — skip lone karat ints at start
  let nums = [...after.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) =>
    Number(m[1].replace(",", ".")),
  );
  // If first number looks like karat (9–24 int) and second is a weight decimal, drop karat
  if (
    nums.length >= 3 &&
    Number.isInteger(nums[0]) &&
    nums[0] >= 9 &&
    nums[0] <= 24 &&
    !Number.isInteger(nums[1]) &&
    nums[1] > 0
  ) {
    nums = nums.slice(1);
  }
  if (nums.length < 2) return parts;

  const fields: OcrRawFieldMap = {
    ...(parts ?? {}),
    designNo: design,
  };
  if (goldCode) fields.goldCode = goldCode;

  fields.grossWeight = nums[0];
  fields.netWeight = nums[1];

  const maybePure = nums[2];
  const maybeSize = nums[3];
  const skipPure =
    maybePure != null &&
    Number.isInteger(maybePure) &&
    maybePure >= 1 &&
    maybePure <= 30 &&
    (maybeSize == null || (maybeSize > 0 && maybeSize < 3));

  let diaStart: number;
  if (skipPure) {
    fields.size = String(maybePure);
    diaStart = 3;
  } else {
    if (maybePure != null) fields.pureWeight = maybePure;
    if (maybeSize != null) fields.size = String(maybeSize);
    diaStart = 4;
  }

  const dia =
    nums.slice(diaStart).find((n) => n > 0 && n < 3) ??
    nums.slice(diaStart).find((n) => n > 0 && n < 10) ??
    nums[diaStart];
  if (dia != null) fields.diamondWeight = dia;

  const pcs = [...nums]
    .reverse()
    .find(
      (n) =>
        Number.isInteger(n) &&
        n >= 1 &&
        n <= 500 &&
        n !== Number(fields.size),
    );
  if (pcs != null) fields.diamondPieces = pcs;

  if (/\blab\b/i.test(after)) {
    fields.diamondType = "Lab Grown";
    fields.certified = fields.certified || "Lab";
  } else if (/\bnatural\b/i.test(after)) {
    fields.diamondType = "Natural";
  }

  return fields;
}

/** Fix common OCR character confusion before parsing */
function normalizeOcrNoise(raw: string): string {
  let t = raw.replace(/\r/g, "\n");
  // Normalize weird spaces / pipes
  t = t.replace(/[·•]/g, ".");
  // Fix metal codes: G1OW→G10W, G105→G10Y, S925 spacing
  t = t.replace(
    /\b([G])[\s]*([OIl0-9]{1,2})[\s]*([YWR5SVMBPKN])\b/gi,
    (_, m, p, c) => {
      const normalized = normalizeGoldToken(`${m}${p}${c}`);
      return normalized ?? `${m}${p}${c}`.toUpperCase();
    },
  );
  t = t.replace(/\bS[\s]*9[\s]*2[\s]*5\b/gi, "S925");
  t = t.replace(/\bS[\s]*9[\s]*9[\s]*9\b/gi, "S999");
  t = t.replace(/\bS[\s]*9[\s]*5[\s]*8\b/gi, "S958");
  return t;
}

/**
 * Normalize OCR metal tokens:
 * G1OW → G10W, G105 → G10Y, S925 / S9Z5 → S925
 */
function normalizeGoldToken(raw: string): string | null {
  let t = raw.replace(/\s+/g, "").toUpperCase();
  t = t.replace(/O/g, "0").replace(/[IL]/g, "1");

  // Silver millesimal (S925, S999) — no color required
  const silver = t.match(/^S(\d{3})([YWR])?$/);
  if (silver) {
    if (!/^(925|999|958)$/.test(silver[1])) return null;
    return silver[2] ? `S${silver[1]}${silver[2]}` : `S${silver[1]}`;
  }

  const m = t.match(/^([G])(\d{1,2})([A-Z0-9])$/);
  if (!m) return null;

  const metal = m[1];
  const purity = m[2];
  if (!/^(9|10|14|18|22|24)$/.test(purity)) return null;

  const colorMap: Record<string, string> = {
    Y: "Y",
    W: "W",
    R: "R",
    "5": "Y",
    S: "Y",
    V: "Y",
    M: "W",
    N: "W",
    B: "R",
    P: "R",
    K: "R",
  };
  const color = colorMap[m[3]];
  if (!color) return null;
  return `${metal}${purity}${color}`;
}

function findGoldCode(text: string): string | null {
  const patterns = [
    // Silver first: S925 / S999
    /\b(S\s*9\s*[OIl25]\s*[OIl259]\s*[YWR]?)\b/i,
    /\b(S\s*999\s*[YWR]?)\b/i,
    /\b(S\s*958\s*[YWR]?)\b/i,
    /\b([G]\s*\d{1,2}\s*[YWR])\b/i,
    /\b([G][OIl0-9]{1,2}[YWR])\b/i,
    // OCR color confusion: G105 / G10S / G10V / G1OW
    /\b([G]\s*[OIl0-9]{1,2}\s*[YWR5SVMBPKN])\b/i,
    /\b([G][OIl1][OIl0][YWR5SVMBPKN])\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const normalized = normalizeGoldToken(m[1]);
      if (normalized) return normalized;
    }
  }
  return null;
}

function isBadDesignNo(design: string): boolean {
  const u = design.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefix = u.replace(/[0-9]+$/g, "");
  if (DESIGN_STOPWORDS.has(prefix)) return true;
  if (/^G\d{1,2}[YWR]$/i.test(design.replace(/\s|-/g, ""))) return true;
  if (/^S\d{3}[YWR]?$/i.test(design.replace(/\s|-/g, ""))) return true;
  return false;
}

function findDesignNo(text: string, goldCode: string | null): string | null {
  // Prefer tokens on the same line as gold code
  if (goldCode) {
    const line =
      text.split("\n").find((l) =>
        l.toUpperCase().replace(/\s+/g, "").includes(goldCode),
      ) ?? "";
    const fromLine = designFromTokensBeforeGold(line, goldCode);
    if (fromLine) return fromLine;
  }

  // MSLR 05 / MSLR-05 / LR-0003 / ER 142
  const candidates = [
    ...text.matchAll(/\b([A-Z]{2,6})\s*[-–]?\s*(\d{1,4})\b/gi),
  ];
  for (const m of candidates) {
    const prefix = m[1].toUpperCase();
    const num = m[2];
    if (DESIGN_STOPWORDS.has(prefix)) continue;
    if (prefix.length === 1) continue;
    // Avoid matching pure weight-like fragments
    if (prefix === "WT" || prefix === "CT") continue;
    const formatted =
      num.length >= 3 ? `${prefix}-${num}` : `${prefix} ${num}`;
    if (!isBadDesignNo(formatted)) return formatted.replace(/\s+/g, " ").trim();
  }
  return null;
}

function designFromTokensBeforeGold(
  line: string,
  goldCode: string,
): string | null {
  const cleaned = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  const upper = cleaned.toUpperCase();
  const idx = upper.indexOf(goldCode);
  if (idx < 0) return null;

  const before = cleaned.slice(0, idx).trim();
  // Remove category words from the end of "before"
  const withoutCategory = before
    .replace(/ladies?\s*ring/gi, " ")
    .replace(/gents?\s*ring/gi, " ")
    .replace(/earrings?/gi, " ")
    .replace(/pendant/gi, " ")
    .replace(/bracelet/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = withoutCategory.match(/([A-Za-z]{2,6})\s*[-–]?\s*(\d{1,4})\s*$/);
  if (m) {
    const prefix = m[1].toUpperCase();
    if (DESIGN_STOPWORDS.has(prefix)) return null;
    return m[2].length >= 3
      ? `${prefix}-${m[2]}`
      : `${prefix} ${m[2]}`;
  }

  // Whole leftover if it looks like a code (MSLR05)
  const compact = withoutCategory.replace(/\s+/g, "");
  const m2 = compact.match(/^([A-Za-z]{2,6})(\d{1,4})$/);
  if (m2 && !DESIGN_STOPWORDS.has(m2[1].toUpperCase())) {
    return m2[2].length >= 3
      ? `${m2[1].toUpperCase()}-${m2[2]}`
      : `${m2[1].toUpperCase()} ${m2[2]}`;
  }
  return null;
}

/**
 * Parse numbers after gold code on the same row:
 * Gross, Net, Pure, Size, DiaWt, (optional certified wt), CertPrice?, ..., DiaPcs
 */
function extractFromGoldCodeRow(
  text: string,
  goldCode: string | null,
): OcrRawFieldMap | null {
  if (!goldCode) return null;

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Also try a flattened single line (OCR sometimes wraps badly)
  const flat = text.replace(/\n+/g, " ");
  const candidates = [
    ...lines.filter((l) =>
      l.toUpperCase().replace(/\s+/g, "").includes(goldCode),
    ),
    // Also match lines that still have the raw OCR gold token (G105 etc.)
    ...lines.filter(
      (l) =>
        /[G]\s*[OIl0-9]{1,2}\s*[YWR5SVMBPKN]/i.test(l) ||
        /\bS\s*9\d{2}/i.test(l),
    ),
    flat,
  ];

  for (const line of candidates) {
    // Prefer parsing with normalized gold code present on line
    let fields = parseDataLine(line, goldCode);
    if (!fields || (fields.netWeight == null && fields.grossWeight == null)) {
      // Try substituting OCR gold token with normalized code then parse
      const patched = line.replace(
        /\b(?:[G]\s*[OIl0-9]{1,2}\s*[YWR5SVMBPKN]|S\s*9\d{2}\s*[YWR]?)\b/i,
        goldCode,
      );
      fields = parseDataLine(patched, goldCode);
    }
    if (fields && (fields.netWeight != null || fields.grossWeight != null)) {
      return fields;
    }
  }
  return null;
}

/**
 * When gold code is missing/mangled, still pull weights from the design row:
 * MSLR 07 LADIES RING G105 7.551 6.368 5.80 7 0.014 … 13
 */
function extractFromDesignRow(
  text: string,
  knownDesign?: string,
): OcrRawFieldMap | null {
  const design =
    knownDesign ??
    findDesignNo(text, null);
  if (!design) return null;

  const designCompact = design.replace(/\s+/g, "").toUpperCase();
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const flat = text.replace(/\n+/g, " ");
  const candidates = [
    ...lines.filter((l) =>
      l.toUpperCase().replace(/[\s\-]/g, "").includes(designCompact),
    ),
    flat,
  ];

  for (const line of candidates) {
    const goldOnLine = findGoldCode(line);
    if (goldOnLine) {
      const parsed = parseDataLine(
        line.replace(
          /\b(?:[G]\s*[OIl0-9]{1,2}\s*[YWR5SVMBPKN]|S\s*9\d{2}\s*[YWR]?)\b/i,
          goldOnLine,
        ),
        goldOnLine,
      );
      if (parsed && (parsed.netWeight != null || parsed.grossWeight != null)) {
        return { ...parsed, designNo: design };
      }
    }

    // No gold — take numbers after the design token / category
    const cleaned = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
    const upper = cleaned.toUpperCase().replace(/[\s\-]/g, "");
    const idx = upper.indexOf(designCompact);
    if (idx < 0) continue;

    // Map compact index back roughly: take substring after design in original
    const designMatch = cleaned.match(
      new RegExp(
        design.replace(/\s+/g, "\\s*").replace(/-/g, "[-–]?"),
        "i",
      ),
    );
    let after = designMatch
      ? cleaned.slice((designMatch.index ?? 0) + designMatch[0].length)
      : cleaned;
    after = after
      .replace(/ladies?\s*ring/gi, " ")
      .replace(/gents?\s*ring/gi, " ")
      .replace(/\b(?:[G]\s*[OIl0-9]{1,2}\s*[YWR5SVMBPKN]|S\s*9\d{2}\s*[YWR]?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const nums = [...after.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) =>
      Number(m[1].replace(",", ".")),
    );
    if (nums.length < 2) continue;

    const fields: OcrRawFieldMap = {
      designNo: design,
      grossWeight: nums[0],
      netWeight: nums[1],
    };
    if (nums[2] != null) fields.pureWeight = nums[2];
    if (nums[3] != null) fields.size = String(nums[3]);

    // Dia wt: prefer small carat values (< 3) after size
    const dia =
      nums.slice(4).find((n) => n > 0 && n < 3) ??
      nums.slice(4).find((n) => n > 0 && n < 10) ??
      nums[4];
    if (dia != null) fields.diamondWeight = dia;

    const pcs = [...nums]
      .reverse()
      .find(
        (n) =>
          Number.isInteger(n) &&
          n >= 1 &&
          n <= 500 &&
          n !== Number(fields.size),
      );
    if (pcs != null) fields.diamondPieces = pcs;

    if (goldOnLine) fields.goldCode = goldOnLine;
    return fields;
  }
  return null;
}

/**
 * When OCR reads a table column-wise or cell-wise:
 *   Design Name/No
 *   MSLR 05
 *   Gold qty
 *   G10W
 *   Gross wt.
 *   3.38
 */
function extractFromLabelValuePairs(text: string): OcrRawFieldMap {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const fields: OcrRawFieldMap = {};
  const labelMap: { re: RegExp; key: keyof OcrRawFieldMap; kind: "text" | "num" | "int" }[] = [
    { re: /design\s*(name)?\s*\/?\s*no\.?|design\s*no|product\s*sku/i, key: "designNo", kind: "text" },
    { re: /^category$/i, key: "category", kind: "text" },
    { re: /^metal$/i, key: "goldMetal", kind: "text" },
    { re: /metal\s*purity/i, key: "goldPurity", kind: "text" },
    { re: /metal\s*color/i, key: "goldColor", kind: "text" },
    { re: /gold\s*qty|gold\s*code/i, key: "goldCode", kind: "text" },
    { re: /gross\s*wt\.?|gross\s*weight|^gross$/i, key: "grossWeight", kind: "num" },
    { re: /net\s*wt\.?|net\s*weight|^net$/i, key: "netWeight", kind: "num" },
    { re: /pure\s*wt\.?|pure\s*weight|^pure$/i, key: "pureWeight", kind: "num" },
    { re: /^size$/i, key: "size", kind: "text" },
    { re: /dia\.?\s*wt\.?|diamond\s*wt\.?|diamond\s*weight/i, key: "diamondWeight", kind: "num" },
    { re: /certi?\.?\s*price|certificate\s*price/i, key: "certificatePrice", kind: "num" },
    { re: /^diamond$/i, key: "diamondType", kind: "text" },
    { re: /diamond\s*shape/i, key: "diamondShape", kind: "text" },
    { re: /dia\.?\s*pcs\.?|diamond\s*pcs\.?|dia\.?\s*pieces?/i, key: "diamondPieces", kind: "int" },
  ];

  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i];
    const value = lines[i + 1];
    if (/metal\s*mix/i.test(label)) continue;
    for (const item of labelMap) {
      if (!item.re.test(label)) continue;
      if (fields[item.key] != null) continue;
      if (item.kind === "text") {
        // Skip if next line is also a label
        if (labelMap.some((x) => x.re.test(value))) continue;
        if (/metal\s*mix/i.test(value)) continue;
        let v = value;
        if (item.key === "goldCode") {
          const g = findGoldCode(value) ?? normalizeGoldToken(value);
          if (g) v = g;
          else continue; // don't keep raw garbage as gold code
        }
        if (item.key === "goldMetal" && !/^(gold|silver|platinum)$/i.test(v)) {
          continue;
        }
        if (item.key === "diamondType") {
          if (/\blab/i.test(v)) v = "Lab Grown";
          else if (/natural/i.test(v)) v = "Natural";
        }
        if (item.key === "designNo" && isBadDesignNo(v)) continue;
        fields[item.key] = v;
      } else if (item.kind === "num" || item.kind === "int") {
        const n = Number(value.replace(/,/g, "").replace(/[^\d.-]/g, ""));
        if (!Number.isFinite(n)) continue;
        fields[item.key] = item.kind === "int" ? Math.round(n) : n;
      }
      break;
    }
  }

  // Build code from metal columns after label pass
  if (!fields.goldCode) {
    const built = buildCodeFromFieldParts(fields);
    if (built) fields.goldCode = built;
  }

  return fields;
}

function parseDataLine(line: string, goldCode: string): OcrRawFieldMap | null {
  const normalized = line.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  const upper = normalized.toUpperCase();
  const gIdx = upper.indexOf(goldCode);
  if (gIdx < 0) return null;

  const before = normalized.slice(0, gIdx).trim();
  const after = normalized.slice(gIdx + goldCode.length).trim();

  const fields: OcrRawFieldMap = { goldCode };

  const design = designFromTokensBeforeGold(
    `${before} ${goldCode}`,
    goldCode,
  );
  if (design) fields.designNo = design;

  // Pull numbers in order from the segment after gold code
  const numMatches = [
    ...after.matchAll(/(\d+(?:[.,]\d+)?)/g),
  ].map((m) => Number(m[1].replace(",", ".")));

  if (numMatches.length < 2) return fields;

  // Column order on jewellery sheets:
  // 0 gross, 1 net, 2 pure?, 3 size, 4 dia wt — silver rows often omit pure
  fields.grossWeight = numMatches[0];
  fields.netWeight = numMatches[1];

  const maybePure = numMatches[2];
  const maybeSize = numMatches[3];
  const skipPure =
    maybePure != null &&
    Number.isInteger(maybePure) &&
    maybePure >= 1 &&
    maybePure <= 30 &&
    (maybeSize == null || (maybeSize > 0 && maybeSize < 3));

  let sizeIdx: number;
  let diaStart: number;
  if (skipPure) {
    fields.size = String(maybePure);
    sizeIdx = 2;
    diaStart = 3;
  } else {
    if (maybePure != null) fields.pureWeight = maybePure;
    if (maybeSize != null) fields.size = String(maybeSize);
    sizeIdx = 3;
    diaStart = 4;
  }

  // Dia wt: prefer a small carat value (< 3) after size, else < 10
  const diaCandidate =
    numMatches.slice(diaStart).find((n) => n > 0 && n < 3) ??
    numMatches.slice(diaStart).find((n) => n > 0 && n < 10) ??
    numMatches[diaStart];
  if (diaCandidate != null) fields.diamondWeight = diaCandidate;

  // Cert price often a large integer (> 1000)
  const certPrice = numMatches.find((n) => Number.isInteger(n) && n >= 1000);
  if (certPrice != null) fields.certificatePrice = certPrice;

  // Pieces: last integer between 1 and 500 that isn't size/cert
  const pcs = [...numMatches]
    .reverse()
    .find(
      (n) =>
        Number.isInteger(n) &&
        n >= 1 &&
        n <= 500 &&
        n !== Number(fields.size) &&
        n !== certPrice &&
        !(skipPure === false && n === maybePure && maybePure > 30),
    );
  if (pcs != null) fields.diamondPieces = pcs;

  if (/\blab\b/i.test(after)) fields.diamondType = "Lab Grown";
  if (/\brd\b|\brnd\b|\bround\b/i.test(after)) fields.diamondShape = "Round";

  void sizeIdx;
  return fields;
}

function assignIfMissing(
  fields: OcrRawFieldMap,
  key: keyof OcrRawFieldMap,
  getter: () => string | number | null,
): void {
  if (fields[key] != null && fields[key] !== "") return;
  const value = getter();
  if (value != null && value !== "") fields[key] = value;
}

function matchLabeled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(
      `\\b${label}\\b\\s*[:\\-–]?\\s*([A-Za-z0-9][A-Za-z0-9 .\\/()\\-]{0,40})`,
      "i",
    );
    const m = text.match(re);
    if (m?.[1]) return m[1].split(/\n/)[0].trim();
  }
  return null;
}

function matchNumberNear(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const re = new RegExp(
      `\\b${label}\\b\\s*[:\\-–]?\\s*([0-9]+(?:[.,][0-9]+)?)`,
      "i",
    );
    const m = text.match(re);
    if (m?.[1]) {
      const n = Number(m[1].replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
