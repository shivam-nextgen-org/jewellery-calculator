import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { updateSilverRate } from "@/lib/services/silver-rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronSecretAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  return token === secret;
}

/**
 * Manual (logged-in USER) or cron (Bearer CRON_SECRET).
 * Always uses updateSilverRate() — never writes on failure.
 */
export async function POST(request: Request) {
  const isCron = cronSecretAuthorized(request);
  if (!isCron) {
    try {
      await requireUser();
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await updateSilverRate();

  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          "Unable to update silver rate. The previous rate is still being used.",
        detail: result.error,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    silverRate: result.silverRate,
    silverRateLastUpdatedAt: result.silverRateLastUpdatedAt,
    updatedCount: result.updatedCount,
  });
}
