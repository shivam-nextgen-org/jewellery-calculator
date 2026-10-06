import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import type { PricingProfileInput } from "@/types/jewellery";
import {
  archivePricingProfile,
  getPricingProfile,
  PricingProfileValidationError,
  updatePricingProfile,
} from "@/lib/services/pricing-profiles";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
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
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load pricing profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await requireUser();
    const { id } = await context.params;
    const body = (await request.json()) as PricingProfileInput;
    const updated = await updatePricingProfile(session.id, id, body);
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PricingProfileValidationError) {
      const status = error.status ?? 400;
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: "Unable to save pricing profile. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await requireUser();
    const { id } = await context.params;
    const result = await archivePricingProfile(session.id, id);
    return NextResponse.json(result);
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
      { error: "Unable to archive pricing profile. Please try again." },
      { status: 500 },
    );
  }
}
