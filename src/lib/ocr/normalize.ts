import {
  parseGoldCode,
  DEFAULT_GOLD_CODE_CONFIG,
  type GoldCodeParserConfig,
} from "@/lib/gold-code/parser";
import type {
  NormalizedJewelleryExtraction,
  OcrProviderResult,
} from "@/lib/ocr/types";

function toNumber(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function toString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

/**
 * Normalize provider-specific OCR fields into the app jewellery model.
 * Applies gold-code parsing when a code is present.
 */
export function normalizeOcrResult(
  result: OcrProviderResult,
  goldConfig: GoldCodeParserConfig = DEFAULT_GOLD_CODE_CONFIG,
): NormalizedJewelleryExtraction {
  const f = result.fields;
  const warnings = [...result.warnings];

  const goldCode = toString(f.goldCode);
  const parsed = parseGoldCode(goldCode, goldConfig);

  let goldMetal = toString(f.goldMetal);
  let goldPurity = toString(f.goldPurity);
  let goldColor = toString(f.goldColor);
  let goldCodeParsed = false;
  let unknownGoldCode = false;

  if (parsed.ok) {
    goldCodeParsed = true;
    goldMetal = goldMetal || parsed.metalLabel;
    goldPurity = goldPurity || parsed.purity;
    goldColor = goldColor || parsed.colorLabel;
  } else if (goldCode) {
    unknownGoldCode = true;
    warnings.push(parsed.reason);
  }

  const designNo = toString(f.designNo);
  const netWeight = toNumber(f.netWeight);
  const diamondWeight = toNumber(f.diamondWeight);

  if (!designNo) warnings.push("Missing design number");
  if (netWeight <= 0) warnings.push("Missing or invalid net weight");
  if (diamondWeight < 0) warnings.push("Invalid diamond weight");

  const certRaw = f.certificatePrice;
  const certificatePrice =
    certRaw == null || certRaw === ""
      ? null
      : toNumber(certRaw, NaN);
  const cert =
    certificatePrice != null && Number.isFinite(certificatePrice)
      ? certificatePrice
      : null;

  return {
    designNo,
    category: toString(f.category, "Uncategorised"),
    goldCode: parsed.ok ? parsed.normalizedCode : goldCode,
    goldMetal,
    goldPurity,
    goldColor,
    grossWeight: toNumber(f.grossWeight),
    netWeight,
    pureWeight: toNumber(f.pureWeight),
    size: toString(f.size),
    diamondWeight,
    diamondShape: toString(f.diamondShape),
    diamondType: toString(f.diamondType),
    diamondPurity: toString(f.diamondPurity),
    diamondPieces: Math.round(toNumber(f.diamondPieces)),
    certified: toString(f.certified),
    certificatePrice: cert,
    meta: {
      provider: result.provider,
      confidence: result.confidence,
      warnings,
      goldCodeParsed,
      unknownGoldCode,
      rawText: result.rawText?.trim() || undefined,
    },
  };
}
