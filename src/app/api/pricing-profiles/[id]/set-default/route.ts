import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import {
  PricingProfileValidationError,
  setDefaultPricingProfile,
} from "@/lib/services/pricing-profiles";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const session = await requireUser();
    const { id } = await context.params;
    const profile = await setDefaultPricingProfile(session.id, id);
    return NextResponse.json(profile);
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
      { error: "Unable to set default pricing profile. Please try again." },
      { status: 500 },
    );
  }
}
