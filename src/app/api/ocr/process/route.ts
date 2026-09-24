import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import { processJewelleryImage } from "@/lib/services/ocr";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let fileName: string | null = null;
    let mimeType: string | null = null;
    let buffer: Buffer | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file && typeof file !== "string") {
        fileName = file.name;
        mimeType = file.type || "image/jpeg";
        const bytes = await file.arrayBuffer();
        buffer = Buffer.from(bytes);
      } else {
        fileName = String(form.get("fileName") ?? "") || null;
      }
    } else {
      const body = (await request.json().catch(() => null)) as {
        fileName?: string;
      } | null;
      fileName = body?.fileName ?? null;
    }

    const providerId = process.env.OCR_PROVIDER ?? "tesseract";

    if (providerId === "tesseract" && (!buffer || buffer.length === 0)) {
      return NextResponse.json(
        {
          error:
            "Real OCR needs an image file. Browse or drop a design-sheet photo, then Process image.",
        },
        { status: 400 },
      );
    }

    if (!fileName && !buffer) {
      return NextResponse.json(
        { error: "Upload an image or provide a file name" },
        { status: 400 },
      );
    }

    // Soft size guard (~10MB)
    if (buffer && buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image too large. Please upload under 10 MB." },
        { status: 400 },
      );
    }

    const session = await requireUser();
    const result = await processJewelleryImage(
      {
        fileName,
        mimeType,
        buffer,
      },
      session.id,
    );

    return NextResponse.json({
      importId: result.importId,
      data: {
        designNo: result.extraction.designNo,
        category: result.extraction.category,
        goldCode: result.extraction.goldCode,
        goldMetal: result.extraction.goldMetal,
        goldPurity: result.extraction.goldPurity,
        goldColor: result.extraction.goldColor,
        grossWeight: result.extraction.grossWeight,
        netWeight: result.extraction.netWeight,
        pureWeight: result.extraction.pureWeight,
        size: result.extraction.size,
        diamondWeight: result.extraction.diamondWeight,
        diamondShape: result.extraction.diamondShape,
        diamondType: result.extraction.diamondType,
        diamondPurity: result.extraction.diamondPurity,
        diamondPieces: result.extraction.diamondPieces,
        certified: result.extraction.certified,
        certificatePrice: result.extraction.certificatePrice,
      },
      meta: result.extraction.meta,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    const message =
      error instanceof Error ? error.message : "OCR processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
