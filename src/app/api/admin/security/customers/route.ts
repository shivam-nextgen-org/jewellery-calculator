import { NextResponse } from "next/server";
import { beginCenterRequest, centerApiFail } from "@/lib/security/admin-security-center-api";
import { listCustomerSecurity } from "@/lib/security/admin-security-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/security/customers — security summary for every customer. */
export async function GET() {
  try {
    const { db } = await beginCenterRequest();
    return NextResponse.json({ customers: await listCustomerSecurity(db) });
  } catch (error) {
    return centerApiFail(error);
  }
}
