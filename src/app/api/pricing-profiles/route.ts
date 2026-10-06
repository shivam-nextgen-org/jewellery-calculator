import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import type { DiamondTypeOption, PricingProfileInput } from "@/types/jewellery";
import {
  createPricingProfile,
  ensureDefaultPricingProfiles,
  listPricingProfiles,
  PricingProfileValidationError,
} from "@/lib/services/pricing-profiles";

const STONE_TYPES: DiamondTypeOption[] = ["natural", "lab-grown", "moissanite"];

export async function GET(request: Request) {
  try {
    const session = await requireUser();
    const { searchParams } = new URL(request.url);
    const stoneTypeParam = searchParams.get("stoneType");
    const stoneType =
      stoneTypeParam && STONE_TYPES.includes(stoneTypeParam as DiamondTypeOption)
        ? (stoneTypeParam as DiamondTypeOption)
        : undefined;

    await ensureDefaultPricingProfiles(session.id);
    const profiles = await listPricingProfiles(session.id, stoneType);
    return NextResponse.json(profiles);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load pricing profiles" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireUser();
    const body = (await request.json()) as PricingProfileInput;
    const created = await createPricingProfile(session.id, body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PricingProfileValidationError) {
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status: 400 },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "Unable to save pricing profile. Please try again." },
      { status: 500 },
    );
  }
}
