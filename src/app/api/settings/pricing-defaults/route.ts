import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import { getPricingDefaults, setPricingDefaults } from "@/lib/services/settings";
import { syncSettingsRatesToDefaultProfiles } from "@/lib/services/pricing-profiles";
import type { PricingDefaults } from "@/types/jewellery";

export async function GET() {
  try {
    const session = await requireUser();
    const defaults = await getPricingDefaults(session.id);
    return NextResponse.json(defaults);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load pricing defaults" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as PricingDefaults;
    if (
      body.gold24kRate == null ||
      (body.defaultDiamondRateNatural == null &&
        body.defaultDiamondRate == null) ||
      !body.purityPercentages
    ) {
      return NextResponse.json(
        { error: "Invalid pricing defaults payload" },
        { status: 400 },
      );
    }
    const session = await requireUser();
    const saved = await setPricingDefaults(session.id, body);
    await syncSettingsRatesToDefaultProfiles(session.id, saved);
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to save pricing defaults" },
      { status: 500 },
    );
  }
}
