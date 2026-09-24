import { getDb, idOf, ObjectId, oid } from "@/lib/mongo";
import {
  getOcrProvider,
  normalizeOcrResult,
  type NormalizedJewelleryExtraction,
  type OcrProcessInput,
} from "@/lib/ocr";

export interface ProcessOcrResult {
  importId: string;
  extraction: NormalizedJewelleryExtraction;
}

export async function processJewelleryImage(
  input: OcrProcessInput,
  userId: string,
): Promise<ProcessOcrResult> {
  const provider = getOcrProvider();
  const raw = await provider.process(input);
  const extraction = normalizeOcrResult(raw);
  const db = await getDb();
  const now = new Date();
  const importId = new ObjectId();
  const extractedId = new ObjectId();

  await db.collection("OcrImport").insertOne({
    _id: importId,
    userId: oid(userId),
    fileName: input.fileName ?? null,
    status: provider.id,
    createdAt: now,
  });

  await db.collection("OcrExtractedData").insertOne({
    _id: extractedId,
    importId,
    designNo: extraction.designNo || "UNKNOWN",
    category: extraction.category,
    goldCode: extraction.goldCode || null,
    goldMetal: extraction.goldMetal || null,
    goldPurity: extraction.goldPurity || null,
    goldColor: extraction.goldColor || null,
    grossWeight: extraction.grossWeight || null,
    netWeight: extraction.netWeight || 0,
    pureWeight: extraction.pureWeight || null,
    size: extraction.size || null,
    diamondWeight: extraction.diamondWeight || 0,
    diamondShape: extraction.diamondShape || null,
    diamondType: extraction.diamondType || null,
    diamondPurity: extraction.diamondPurity || null,
    diamondPieces: extraction.diamondPieces || null,
    certified: extraction.certified || null,
    certificatePrice: extraction.certificatePrice,
    rawJson: {
      provider: raw.provider,
      confidence: raw.confidence,
      rawText: raw.rawText,
      fields: raw.fields,
      warnings: extraction.meta.warnings,
      goldCodeParsed: extraction.meta.goldCodeParsed,
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    importId: idOf(importId),
    extraction,
  };
}
