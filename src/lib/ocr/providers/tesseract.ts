/**
 * Real OCR via Tesseract.js (local traineddata — no CDN fetch at runtime).
 * Uses multiple page-segmentation modes and keeps the best parse.
 */
import path from "node:path";
import fs from "node:fs";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { parseJewellerySheetText } from "../parse-sheet-text";
import type { OcrProcessInput, OcrProvider, OcrProviderResult } from "../types";

const TESSDATA_DIR = path.join(process.cwd(), "tessdata");
const OCR_TIMEOUT_MS = 120_000;

let sharedWorker: Worker | null = null;
let workerInit: Promise<Worker> | null = null;

function noopLogger() {
  // tesseract.js always invokes logger — must be a function
}

function assertTessdataPresent() {
  const gz = path.join(TESSDATA_DIR, "eng.traineddata.gz");
  const raw = path.join(TESSDATA_DIR, "eng.traineddata");
  if (!fs.existsSync(gz) && !fs.existsSync(raw)) {
    throw new Error(
      "OCR language file missing. Run: npm run ocr:tessdata  then restart the server.",
    );
  }
  return fs.existsSync(gz);
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out after ${Math.round(ms / 1000)}s. Try a smaller/clearer image.`,
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getWorker(): Promise<Worker> {
  if (sharedWorker) return sharedWorker;

  if (!workerInit) {
    workerInit = (async () => {
      const useGzip = assertTessdataPresent();
      const worker = await createWorker("eng", 1, {
        langPath: TESSDATA_DIR,
        gzip: useGzip,
        cacheMethod: "none",
        logger:
          process.env.OCR_DEBUG === "1"
            ? (m) => console.log("[ocr]", m)
            : noopLogger,
      });
      sharedWorker = worker;
      return worker;
    })().catch((err) => {
      workerInit = null;
      sharedWorker = null;
      throw err;
    });
  }

  return workerInit;
}

function scoreParse(fields: Record<string, unknown>): number {
  let score = 0;
  if (fields.goldCode) score += 5;
  if (fields.designNo) score += 3;
  if (fields.netWeight && Number(fields.netWeight) > 0) score += 4;
  if (fields.diamondWeight != null && Number(fields.diamondWeight) >= 0) {
    score += 3;
  }
  if (fields.grossWeight && Number(fields.grossWeight) > 0) score += 2;
  if (fields.category) score += 1;
  if (fields.diamondPieces) score += 1;
  return score;
}

export class TesseractOcrProvider implements OcrProvider {
  readonly id = "tesseract";
  readonly label = "Tesseract OCR";

  async process(input: OcrProcessInput): Promise<OcrProviderResult> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new Error(
        "Tesseract OCR requires an uploaded image file. Please browse/drop an image and try again.",
      );
    }

    try {
      const worker = await withTimeout(
        getWorker(),
        OCR_TIMEOUT_MS,
        "OCR worker init",
      );

      // Table / single-row sheets: try several layout modes and keep best parse
      const modes: PSM[] = [
        PSM.SPARSE_TEXT,
        PSM.SINGLE_BLOCK,
        PSM.SINGLE_LINE,
        PSM.AUTO,
      ];

      let best: {
        text: string;
        confidence: number;
        fields: ReturnType<typeof parseJewellerySheetText>["fields"];
        warnings: string[];
        score: number;
      } | null = null;

      for (const mode of modes) {
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          preserve_interword_spaces: "1",
        });

        const {
          data: { text, confidence },
        } = await withTimeout(
          worker.recognize(input.buffer),
          OCR_TIMEOUT_MS,
          "OCR reading",
        );

        const rawText = (text ?? "").trim();
        if (!rawText) continue;

        const parsed = parseJewellerySheetText(rawText);
        const score = scoreParse(parsed.fields);
        if (!best || score > best.score) {
          best = {
            text: rawText,
            confidence: confidence ?? 0,
            fields: parsed.fields,
            warnings: parsed.warnings,
            score,
          };
        }
        // Good enough — stop early
        if (score >= 14) break;
      }

      if (!best) {
        return {
          provider: this.id,
          confidence: 0,
          rawText: "",
          fields: {},
          warnings: [
            "OCR returned empty text. Try a clearer / higher-resolution crop of the table row.",
          ],
        };
      }

      const confidence01 = Math.max(0, Math.min(1, best.confidence / 100));
      const warnings = [...best.warnings];
      if (best.score < 8) {
        warnings.push(
          "Low parse confidence — please correct fields carefully before pricing.",
        );
      }

      return {
        provider: this.id,
        confidence: confidence01,
        rawText: best.text,
        fields: best.fields,
        warnings,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "OCR processing failed";
      await terminateTesseractWorker().catch(() => undefined);
      throw new Error(message);
    }
  }
}

export async function terminateTesseractWorker(): Promise<void> {
  if (sharedWorker) {
    await sharedWorker.terminate();
  }
  sharedWorker = null;
  workerInit = null;
}
