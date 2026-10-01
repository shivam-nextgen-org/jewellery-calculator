import { NextResponse } from "next/server";
import {
  beginDeviceRequest,
  currentDeviceId,
  deviceApiFail,
} from "@/lib/security/device-api";
import { listDevices, toDeviceView } from "@/lib/security/device-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/devices — the signed-in customer's own devices. */
export async function GET() {
  try {
    const { user, db } = await beginDeviceRequest();
    const [devices, current] = await Promise.all([
      listDevices(db, user.id),
      currentDeviceId(db, user),
    ]);
    return NextResponse.json({
      devices: devices.map((device) => toDeviceView(device, current)),
    });
  } catch (error) {
    return deviceApiFail(error);
  }
}
