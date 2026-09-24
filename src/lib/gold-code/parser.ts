import type {
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
} from "@/types/jewellery";

/**
 * Jewellery metal-code parser.
 *
 * Gold:   G10Y → Gold / 10K / Yellow Gold  (G + karat + color)
 * Silver: S925 → Silver / 925              (S + millesimal, optional color)
 *
 * Codes start with G (gold) or S (silver).
 */

export interface GoldCodeParserConfig {
  metalPrefixes: Record<string, { metal: GoldMetalOption; label: string }>;
  colorSuffixes: Record<
    string,
    { color: GoldColorOption; label: string }
  >;
  /** Karat digits → purity, e.g. "10" → "10K" (gold codes) */
  purityMap: Record<string, GoldPurityOption>;
  /** Millesimal digits → purity, e.g. "925" → "925" (silver codes) */
  silverPurityMap: Record<string, GoldPurityOption>;
}

export const DEFAULT_GOLD_CODE_CONFIG: GoldCodeParserConfig = {
  metalPrefixes: {
    G: { metal: "gold", label: "Gold" },
    S: { metal: "silver", label: "Silver" },
  },
  colorSuffixes: {
    Y: { color: "yellow", label: "Yellow Gold" },
    W: { color: "white", label: "White Gold" },
    R: { color: "rose", label: "Rose Gold" },
  },
  purityMap: {
    "9": "9K",
    "10": "10K",
    "14": "14K",
    "18": "18K",
    "22": "22K",
    "24": "24K",
  },
  silverPurityMap: {
    "925": "925",
    "999": "999",
    "958": "958",
  },
};

export interface ParsedGoldCode {
  input: string;
  normalizedCode: string;
  metal: GoldMetalOption;
  metalLabel: string;
  purity: GoldPurityOption;
  color: GoldColorOption;
  colorLabel: string;
  ok: true;
}

export interface FailedGoldCodeParse {
  input: string;
  ok: false;
  reason: string;
}

export type GoldCodeParseResult = ParsedGoldCode | FailedGoldCodeParse;

export function parseGoldCode(
  raw: string | null | undefined,
  config: GoldCodeParserConfig = DEFAULT_GOLD_CODE_CONFIG,
): GoldCodeParseResult {
  const input = (raw ?? "").trim();
  if (!input) {
    return { input, ok: false, reason: "Empty gold code" };
  }

  const normalizedCode = input.toUpperCase().replace(/[\s\-_]/g, "");

  // Only G (gold) and S (silver) prefixes
  if (!/^[GS]/.test(normalizedCode)) {
    return {
      input,
      ok: false,
      reason: `Code must start with G (gold) or S (silver): ${input}`,
    };
  }

  // Silver millesimal: S925, S999, S925W
  const silverMatch = normalizedCode.match(/^S(\d{3})([YWR])?$/);
  if (silverMatch) {
    const fineness = silverMatch[1];
    const purity = config.silverPurityMap[fineness];
    if (!purity) {
      return {
        input,
        ok: false,
        reason: `Unknown silver purity "${fineness}" in ${normalizedCode}`,
      };
    }

    const colorKey = (silverMatch[2] ?? "W").toUpperCase();
    const colorRule = config.colorSuffixes[colorKey] ?? config.colorSuffixes.W;
    const colorLabel =
      colorKey === "Y"
        ? "Yellow"
        : colorKey === "R"
          ? "Rose"
          : "White";

    return {
      input,
      normalizedCode: silverMatch[2]
        ? `S${fineness}${colorKey}`
        : `S${fineness}`,
      metal: "silver",
      metalLabel: "Silver",
      purity,
      color: colorRule.color,
      colorLabel,
      ok: true,
    };
  }

  // Gold karat + color: G10Y, G14W, G18R
  const goldMatch = normalizedCode.match(/^G(\d{1,2})([YWR])$/);
  if (goldMatch) {
    const purityKey = goldMatch[1];
    const colorKey = goldMatch[2].toUpperCase();
    const purity = config.purityMap[purityKey];
    if (!purity) {
      return {
        input,
        ok: false,
        reason: `Unknown gold purity "${purityKey}" in ${normalizedCode}`,
      };
    }
    const colorRule = config.colorSuffixes[colorKey];
    if (!colorRule) {
      return {
        input,
        ok: false,
        reason: `Unknown color suffix "${colorKey}" in ${normalizedCode}`,
      };
    }

    return {
      input,
      normalizedCode: `G${purityKey}${colorKey}`,
      metal: "gold",
      metalLabel: "Gold",
      purity,
      color: colorRule.color,
      colorLabel: colorRule.label,
      ok: true,
    };
  }

  // OCR-tolerant gold: G105 → try as G10Y
  const goldOcr = normalizedCode.match(/^G(\d{1,2})([5SVMBPKN])$/);
  if (goldOcr) {
    const colorMap: Record<string, string> = {
      "5": "Y",
      S: "Y",
      V: "Y",
      M: "W",
      N: "W",
      B: "R",
      P: "R",
      K: "R",
    };
    const mapped = colorMap[goldOcr[2]];
    if (mapped) {
      return parseGoldCode(`G${goldOcr[1]}${mapped}`, config);
    }
  }

  return {
    input,
    ok: false,
    reason: `Unknown metal code format: ${input}. Use G10Y (gold) or S925 (silver).`,
  };
}

/** Map parsed purity/color into variation checkbox selection helpers */
export function variationHintsFromGoldCode(parsed: ParsedGoldCode): {
  metals: GoldMetalOption[];
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
} {
  return {
    metals: [parsed.metal],
    purities: [parsed.purity],
    colors: [parsed.color],
  };
}

/**
 * Build metal code from final-sheet columns (ignore Metal Mix).
 * e.g. Metal=Gold, Purity=10, Color=Rose Gold → G10R
 *      Metal=Silver, Purity=925 → S925
 */
export function buildMetalCodeFromParts(
  metalRaw: string | null | undefined,
  purityRaw: string | number | null | undefined,
  colorRaw: string | null | undefined,
): GoldCodeParseResult {
  const metalText = String(metalRaw ?? "").trim().toLowerCase();
  const purityText = String(purityRaw ?? "").trim();
  const colorText = String(colorRaw ?? "").trim();

  if (!metalText) {
    return { input: "", ok: false, reason: "Missing metal" };
  }

  if (/^sil/.test(metalText) || metalText === "s") {
    const digits = purityText.replace(/[^0-9]/g, "");
    const fineness =
      digits.length >= 3 ? digits.slice(0, 3) : digits.padStart(3, "0");
    const colorLetter = /rose/i.test(colorText)
      ? "R"
      : /yellow/i.test(colorText)
        ? "Y"
        : /white/i.test(colorText)
          ? "W"
          : undefined;
    return parseGoldCode(
      colorLetter ? `S${fineness}${colorLetter}` : `S${fineness}`,
    );
  }

  if (!/^gol/.test(metalText) && metalText !== "g") {
    return {
      input: `${metalRaw}/${purityRaw}/${colorRaw}`,
      ok: false,
      reason: `Unknown metal "${metalRaw}"`,
    };
  }

  const karat = purityText.replace(/[^0-9]/g, "").replace(/^0+/, "") || purityText;
  const colorLetter = /rose/i.test(colorText)
    ? "R"
    : /white/i.test(colorText)
      ? "W"
      : /yellow/i.test(colorText)
        ? "Y"
        : null;

  if (!colorLetter) {
    return {
      input: `${metalRaw}/${purityRaw}/${colorRaw}`,
      ok: false,
      reason: `Unknown metal color "${colorRaw}"`,
    };
  }

  return parseGoldCode(`G${karat}${colorLetter}`);
}
