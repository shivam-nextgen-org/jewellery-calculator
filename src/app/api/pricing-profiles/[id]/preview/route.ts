import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import {
  getPricingProfile,
  previewPricingProfile,
  PricingProfileValidationError,
} from "@/lib/services/pricing-profiles";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireUser();
    const { id } = await context.params;
    const profile = await getPricingProfile(session.id, id);
    if (!profile) {
      return NextResponse.json(
        { error: "Pricing profile not found." },
        { status: 404 },
      );
    }

    const body = (await request.json()) as {
      colorGrade?: string;
      clarityGrade?: string;
      carat?: number;
    };

    if (!body.colorGrade?.trim() || !body.clarityGrade?.trim()) {
      return NextResponse.json(
        { error: "Please select a color and clarity for the preview." },
        { status: 400 },
      );
    }

    const preview = previewPricingProfile(profile, {
      colorGrade: body.colorGrade.trim(),
      clarityGrade: body.clarityGrade.trim(),
      carat: body.carat,
    });
    return NextResponse.json(preview);
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
      { error: "Unable to preview pricing. Please try again." },
      { status: 500 },
    );
  }
}
