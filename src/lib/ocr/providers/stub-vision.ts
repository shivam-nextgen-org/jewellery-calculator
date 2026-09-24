/**
 * Stub for a future real OCR provider (Tesseract / Google Vision / Azure).
 * Implements the same interface — wire via getOcrProvider() when ready.
 */
import type { OcrProcessInput, OcrProvider, OcrProviderResult } from "../types";

export class StubVisionOcrProvider implements OcrProvider {
  readonly id = "vision-stub";
  readonly label = "Vision OCR (not configured)";

  async process(_input: OcrProcessInput): Promise<OcrProviderResult> {
    throw new Error(
      "Vision OCR provider is not configured. Set OCR_PROVIDER=mock or implement this provider.",
    );
  }
}
