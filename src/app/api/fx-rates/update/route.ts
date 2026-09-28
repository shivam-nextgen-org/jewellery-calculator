import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { updateDailyRates } from "@/lib/services/fx-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronSecretAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return false;
  return auth.slice(7).trim() === secret;
}

/** Manual (USER) or cron (Bearer CRON_SECRET) — shared updateDailyRates(). */
export async function POST(request: Request) {
  if (!cronSecretAuthorized(request)) {
    try {
      await requireUser();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await updateDailyRates();
  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          "Unable to update currency rates. The previous snapshot is still being used.",
        detail: result.error,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    effectiveDate: result.snapshot.effectiveDate,
    capturedAt: result.snapshot.capturedAt,
    rates: result.snapshot.rates,
  });
}
