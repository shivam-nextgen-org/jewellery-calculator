/**
 * Provider-independent OCR contracts.
 * Swap providers (mock → Tesseract / Vision / Azure) without changing UI.
 */

export interface OcrRawFieldMap {
  designNo?: string;
  category?: string;
  goldCode?: string;
  goldMetal?: string;
  goldPurity?: string;
  goldColor?: string;
  grossWeight?: string | number;
  netWeight?: string | number;
  pureWeight?: string | number;
  size?: string;
  diamondWeight?: string | number;
  diamondShape?: string;
  diamondType?: string;
  diamondPurity?: string;
  diamondPieces?: string | number;
  certified?: string;
  certificatePrice?: string | number | null;
  [key: string]: unknown;
}

export interface OcrProviderResult {
  provider: string;
  confidence: number;
  rawText?: string;
  fields: OcrRawFieldMap;
  warnings: string[];
}

export interface OcrProcessInput {
  fileName?: string | null;
  mimeType?: string | null;
  /** Optional file bytes for real providers; mock may ignore. */
  buffer?: Buffer | null;
}

export interface OcrProvider {
  readonly id: string;
  readonly label: string;
  process(input: OcrProcessInput): Promise<OcrProviderResult>;
}

export interface NormalizedJewelleryExtraction {
  designNo: string;
  category: string;
  goldCode: string;
  goldMetal: string;
  goldPurity: string;
  goldColor: string;
  grossWeight: number;
  netWeight: number;
  pureWeight: number;
  size: string;
  diamondWeight: number;
  diamondShape: string;
  diamondType: string;
  diamondPurity: string;
  diamondPieces: number;
  certified: string;
  certificatePrice: number | null;
  /** Parser / OCR diagnostics for the verify UI */
  meta: {
    provider: string;
    confidence: number;
    warnings: string[];
    goldCodeParsed: boolean;
    unknownGoldCode: boolean;
    /** Raw OCR text so users can see what was actually read */
    rawText?: string;
  };
}
