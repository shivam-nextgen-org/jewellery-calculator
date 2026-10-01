import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import { getDashboardStats } from "@/lib/services/products";

export async function GET() {
  try {
    const session = await requireUser();
    const stats = await getDashboardStats(session.id);
    return NextResponse.json({
      stats: {
        todaysImports: stats.todaysImports,
        current24kGoldRate: stats.current24kGoldRate,
      },
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
