import { NextResponse } from "next/server";
import {
  beginCenterRequest,
  CenterApiError,
  centerApiFail,
} from "@/lib/security/admin-security-center-api";
import { getCustomerSecurityDetail } from "@/lib/security/admin-security-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/security/customers/:id — full security detail for one customer. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await beginCenterRequest();
    const { id } = await params;
    const detail = await getCustomerSecurityDetail(db, id);
    if (!detail) throw new CenterApiError("Not found", 404);
    return NextResponse.json(detail);
  } catch (error) {
    return centerApiFail(error);
  }
}
