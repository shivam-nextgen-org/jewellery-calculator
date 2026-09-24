import type { OcrProcessInput, OcrProvider, OcrProviderResult } from "../types";

/**
 * Mock OCR provider — simulates design-sheet table extraction.
 * Replace with a real provider implementing the same interface.
 *
 * Filename hints (optional):
 * - contains "ER" → earrings sample
 * - contains "PN" → pendant sample
 * - otherwise → LR-0003 ladies ring (spec example)
 */
export class MockOcrProvider implements OcrProvider {
  readonly id = "mock";
  readonly label = "Mock Design Sheet OCR";

  async process(input: OcrProcessInput): Promise<OcrProviderResult> {
    // Simulate network / OCR latency
    await new Promise((r) => setTimeout(r, 450));

    const name = (input.fileName ?? "").toUpperCase();
    const sample = pickSample(name);

    return {
      provider: this.id,
      confidence: sample.confidence,
      rawText: sample.rawText,
      fields: sample.fields,
      warnings: sample.warnings,
    };
  }
}

function pickSample(fileName: string) {
  if (fileName.includes("ER") || fileName.includes("EARRING")) {
    return {
      confidence: 0.91,
      warnings: [] as string[],
      rawText: [
        "Design No | Category | Gold qty | Gross wt. | Net wt. | Pure wt. | Size | Dia Wt. | Certified | Diamond | Purity | Dia pcs.",
        "ER-0142 | EARRINGS | G14W | 3.10 | 2.650 | 1.54 | — | 0.92 | Natural | Round | Natural | 18",
      ].join("\n"),
      fields: {
        designNo: "ER-0142",
        category: "Earrings",
        goldCode: "G14W",
        grossWeight: 3.1,
        netWeight: 2.65,
        pureWeight: 1.54,
        size: "",
        diamondWeight: 0.92,
        diamondShape: "Round",
        diamondType: "Natural",
        diamondPurity: "VS",
        diamondPieces: 18,
        certified: "Natural",
        certificatePrice: null,
      },
    };
  }

  if (fileName.includes("PN") || fileName.includes("PENDANT")) {
    return {
      confidence: 0.88,
      warnings: ["Size not found on sheet"],
      rawText: [
        "Design No | Category | Gold | Gross | Net | Pure | Dia Wt | Shape | Type | Pcs",
        "PN-0088 | PENDANT | G18R | 4.02 | 3.410 | 2.55 | 1.10 | Oval | Lab | 12",
      ].join("\n"),
      fields: {
        designNo: "PN-0088",
        category: "Pendant",
        goldCode: "G18R",
        grossWeight: 4.02,
        netWeight: 3.41,
        pureWeight: 2.55,
        size: "",
        diamondWeight: 1.1,
        diamondShape: "Oval",
        diamondType: "Lab Grown",
        diamondPurity: "VVS",
        diamondPieces: 12,
        certified: "IGI",
        certificatePrice: 850,
      },
    };
  }

  // Spec example LR-0003 / G10Y
  return {
    confidence: 0.94,
    warnings: [] as string[],
    rawText: [
      "Design No | Category | Gold qty | Gross wt. | Net wt. | Pure wt. | Size | Dia Wt. | Certified | Certi price | Diamond | Purity | Diamond | Dia pcs.",
      "LR-0003 | LADIES RING | G10Y | 2.22 | 1.932 | 0.83 | 7 | 1.44 | RND | Natural | 28",
    ].join("\n"),
    fields: {
      designNo: "LR-0003",
      category: "Ladies Ring",
      goldCode: "G10Y",
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
  };
}
