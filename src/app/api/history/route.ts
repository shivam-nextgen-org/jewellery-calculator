import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import { listCalculations } from "@/lib/services/products";
import { decimalToNumber } from "@/lib/services/settings";

export async function GET() {
  try {
    const session = await requireUser();
    const rows = await listCalculations(session.id);
    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        productId: row.productId,
        designNo: row.product.designNo,
        category: row.product.category,
        gold24kRate: decimalToNumber(row.gold24kRate),
        diamondRate: decimalToNumber(row.diamondRate),
        diamondDiscountPercent: decimalToNumber(row.diamondDiscountPercent),
        makingCharge: decimalToNumber(row.makingCharge),
        variationCount: row.variationCount,
        priceMin: decimalToNumber(row.priceMin),
        priceMax: decimalToNumber(row.priceMax),
        createdAt: row.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load history" },
      { status: 500 },
    );
  }
}
