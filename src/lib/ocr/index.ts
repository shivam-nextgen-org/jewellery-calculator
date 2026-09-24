import { MockOcrProvider } from "./providers/mock";
import { StubVisionOcrProvider } from "./providers/stub-vision";
import { TesseractOcrProvider } from "./providers/tesseract";
import type { OcrProvider } from "./types";

export type OcrProviderId = "tesseract" | "mock" | "vision-stub";

/**
 * Factory — choose provider via OCR_PROVIDER env.
 * Default: tesseract (real local OCR). Use mock for demos without images.
 */
export function getOcrProvider(
  id: OcrProviderId | string = process.env.OCR_PROVIDER ?? "tesseract",
): OcrProvider {
  switch (id) {
    case "mock":
      return new MockOcrProvider();
    case "vision-stub":
      return new StubVisionOcrProvider();
    case "tesseract":
    default:
      return new TesseractOcrProvider();
  }
}

export { normalizeOcrResult } from "./normalize";
export { parseJewellerySheetText } from "./parse-sheet-text";
export type {
  NormalizedJewelleryExtraction,
  OcrProcessInput,
  OcrProvider,
  OcrProviderResult,
  OcrRawFieldMap,
} from "./types";
