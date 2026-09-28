import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getLatestSuccessfulSnapshot } from "@/lib/services/fx-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Latest successful daily FX snapshot for display conversion (no external API). */
export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getLatestSuccessfulSnapshot();
  if (!snapshot) {
    return NextResponse.json({
      baseCurrency: "INR",
      rates: { INR: 1 },
      effectiveDate: null,
      capturedAt: null,
      source: null,
    });
  }

  return NextResponse.json({
    baseCurrency: snapshot.baseCurrency,
    rates: snapshot.rates,
    effectiveDate: snapshot.effectiveDate,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
  });
}
