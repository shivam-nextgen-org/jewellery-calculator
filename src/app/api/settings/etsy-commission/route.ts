import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth/session";
import {
  getEtsyCommission,
  getUserEtsyEnabled,
  setEtsyCommission,
} from "@/lib/services/etsy-settings";
import {
  DEFAULT_ETSY_COMMISSION,
  parseEtsyCommission,
  type EtsyCommissionSettings,
} from "@/types/etsy";

export async function GET() {
  try {
    const session = await requireUser();
    const enabled = await getUserEtsyEnabled(session.id);
    if (!enabled) {
      return NextResponse.json(
        { enabled: false, settings: null },
        { status: 200 },
      );
    }
    const settings = await getEtsyCommission(session.id);
    return NextResponse.json({ enabled: true, settings });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Failed to load Etsy settings" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireUser();
    const body = (await request.json()) as Partial<EtsyCommissionSettings>;
    const settings = parseEtsyCommission({
      ...DEFAULT_ETSY_COMMISSION,
      ...body,
    });
    const saved = await setEtsyCommission(session.id, settings);
    return NextResponse.json({ enabled: true, settings: saved });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to save Etsy settings";
    const status = message.includes("not enabled") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
