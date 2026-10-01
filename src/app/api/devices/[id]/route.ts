import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  beginDeviceRequest,
  currentDeviceId,
  DeviceApiError,
  deviceApiFail,
} from "@/lib/security/device-api";
import {
  normalizeDeviceLabel,
  renameDevice,
  revokeDevice,
  toDeviceView,
} from "@/lib/security/device-registry";
import { recordSecurityEvent } from "@/lib/security/events";
import { SESSION_ID_COOKIE } from "@/lib/security/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Ownership is enforced in the query (`{ _id, userId }`), never by a
 * separate check. Another customer's device id is indistinguishable from a
 * non-existent one (404), so ids can't be probed.
 */

/** PATCH /api/devices/:id — rename one of your own devices. Body: { label } */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { user, db } = await beginDeviceRequest();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
    if (!body || typeof body !== "object" || !("label" in body)) {
      throw new DeviceApiError("label is required", 400);
    }
    const label = normalizeDeviceLabel(body.label);
    if (label === undefined) {
      throw new DeviceApiError("label must be text up to 40 characters", 400);
    }
    const device = await renameDevice(db, user.id, id, label);
    if (!device) throw new DeviceApiError("Not found", 404);
    await recordSecurityEvent(db, {
      type: "DEVICE_RENAMED",
      actorType: "USER",
      actorId: user.id,
      userId: user.id,
      deviceId: device._id,
    });
    return NextResponse.json({
      device: toDeviceView(device, await currentDeviceId(db, user)),
    });
  } catch (error) {
    return deviceApiFail(error);
  }
}

/** DELETE /api/devices/:id — revoke one of your own devices. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { user, db } = await beginDeviceRequest();
    const { id } = await params;
    const current = await currentDeviceId(db, user);
    const result = await revokeDevice(db, user.id, id);
    if (result.state === "NOT_FOUND") throw new DeviceApiError("Not found", 404);
    if (result.state === "REVOKED") {
      await recordSecurityEvent(db, {
        type: "DEVICE_REVOKED",
        actorType: "USER",
        actorId: user.id,
        userId: user.id,
        deviceId: result.device._id,
        reasonCodes: ["SELF_SERVICE"],
        metadata: { sessionsRevoked: result.sessionsRevoked },
      });
      if (current && result.device._id.equals(current)) {
        // Its session was just revoked; drop the now-dead session cookie.
        (await cookies()).delete(SESSION_ID_COOKIE);
      }
    }
    return NextResponse.json({ ok: true, alreadyRevoked: result.state === "ALREADY_REVOKED" });
  } catch (error) {
    return deviceApiFail(error);
  }
}
