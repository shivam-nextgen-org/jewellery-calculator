import { NextResponse } from "next/server";
import {
  beginRestrictionRequest,
  restrictionApiFail,
} from "@/lib/security/admin-restriction-api";
import { listRestrictedAccounts } from "@/lib/security/admin-restrictions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/security/restrictions — restricted or review-flagged customers. */
export async function GET() {
  try {
    const { db } = await beginRestrictionRequest();
    return NextResponse.json({ accounts: await listRestrictedAccounts(db) });
  } catch (error) {
    return restrictionApiFail(error);
  }
}
