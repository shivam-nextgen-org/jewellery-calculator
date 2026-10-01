import { NextResponse } from "next/server";
import {
  adminDeviceApiFail,
  beginAdminDeviceRequest,
} from "@/lib/security/admin-device-api";
import { listPendingDevices } from "@/lib/security/device-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/security/devices/pending — the approval queue. */
export async function GET() {
  try {
    const { db } = await beginAdminDeviceRequest();
    return NextResponse.json({ devices: await listPendingDevices(db) });
  } catch (error) {
    return adminDeviceApiFail(error);
  }
}
