import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import { getDashboardStats, listProducts } from "@/lib/services/products";
import { decimalToNumber } from "@/lib/services/settings";

export async function GET() {
  try {
    const session = await requireUser();
    const [stats, recent] = await Promise.all([
      getDashboardStats(session.id),
      listProducts(session.id, 5),
    ]);

    return NextResponse.json({
      stats,
      recentDesigns: recent.map((p) => ({
        id: p.id,
        designNo: p.designNo,
        category: p.category,
        variationCount: p.variationCount,
        priceMin: p.priceMin ? decimalToNumber(p.priceMin) : 0,
        priceMax: p.priceMax ? decimalToNumber(p.priceMax) : 0,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load dashboard" },
      { status: 500 },
    );
  }
}
