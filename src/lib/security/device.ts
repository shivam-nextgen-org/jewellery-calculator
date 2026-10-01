import { ObjectId, type Collection, type Db } from "mongodb";
import {
  SECURITY_COLLECTIONS,
  type DeviceDoc,
  type DeviceStatus,
} from "@/lib/security/collections";
import { getSecurityConfig, RETENTION } from "@/lib/security/config";
import { generateOpaqueToken, isOpaqueToken, sha256Hex } from "@/lib/security/crypto";
import { requireObjectId } from "@/lib/security/ids";

/**
 * Device identity foundation (I1).
 *
 * A device is identified by an opaque, server-issued CSPRNG secret carried in
 * an HttpOnly cookie. Only sha256(secret) is stored. No fingerprinting, no IP.
 *
 * These are the primitives; registration, limits and the self-service
 * lifecycle live in ./device-registry.ts. Verification is I3.
 */

export const DEVICE_COOKIE = "atelier_device";

const DAY_MS = 24 * 60 * 60 * 1000;

export function generateDeviceSecret(): string {
  return generateOpaqueToken();
}

export function hashDeviceSecret(secret: string): string {
  return sha256Hex(secret);
}

/** Returns the secret only if the cookie value is well-formed; otherwise null. */
export function parseDeviceCookie(value: string | null | undefined): string | null {
  return isOpaqueToken(value) ? value : null;
}

export type DeviceCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

/** Approved properties (ADR-012). `secure` follows the shared cookie policy. */
export function deviceCookieOptions(
  config = getSecurityConfig(),
): DeviceCookieOptions {
  return {
    httpOnly: true,
    secure: config.device.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: config.device.cookieMaxAgeDays * 24 * 60 * 60,
  };
}

function devices(db: Db): Collection<DeviceDoc> {
  return db.collection<DeviceDoc>(SECURITY_COLLECTIONS.device);
}

function cleanDescriptor(value: string | null | undefined, max = 64) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export type NewDeviceInput = {
  userId: string | ObjectId;
  platform?: string | null;
  browserFamily?: string | null;
  now?: Date;
};

/**
 * Creates a PENDING_VERIFICATION device and returns the raw secret exactly
 * once (for the caller to put in the cookie). Trusting a device is a later
 * phase and must go through the replaceable verifier.
 */
export async function createPendingDevice(
  db: Db,
  input: NewDeviceInput,
): Promise<{ device: DeviceDoc; secret: string }> {
  const now = input.now ?? new Date();
  const secret = generateDeviceSecret();
  const device: DeviceDoc = {
    _id: new ObjectId(),
    userId: requireObjectId(input.userId, "userId"),
    secretHash: hashDeviceSecret(secret),
    status: "PENDING_VERIFICATION",
    label: null,
    platform: cleanDescriptor(input.platform),
    browserFamily: cleanDescriptor(input.browserFamily),
    firstSeenAt: now,
    lastSeenAt: now,
    verifiedAt: null,
    revokedAt: null,
    purgeAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await devices(db).insertOne(device);
  return { device, secret };
}

/** Looks up a device from the presented cookie value. Malformed input never reaches the DB. */
export async function findDeviceBySecret(
  db: Db,
  cookieValue: string | null | undefined,
): Promise<DeviceDoc | null> {
  const secret = parseDeviceCookie(cookieValue);
  if (!secret) return null;
  return devices(db).findOne({ secretHash: hashDeviceSecret(secret) });
}

/**
 * Only TRUSTED devices pass the device-trust check. Pending devices may hold
 * a session (so an admin approval in I3 takes effect without a re-login), but
 * authorize() reports them as UNTRUSTED.
 */
export function isDeviceTrusted(device: Pick<DeviceDoc, "status"> | null): boolean {
  return device?.status === "TRUSTED";
}

/**
 * Short code shown to both the customer and the admin so they can confirm
 * they mean the same pending device. Derived from the public device id, not
 * from the secret, so it reveals nothing.
 */
export function deviceReferenceCode(deviceId: { toHexString(): string }): string {
  const hex = deviceId.toHexString().slice(-8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** When a revoked/expired device record becomes eligible for TTL purge (G8). */
export function devicePurgeDate(from: Date): Date {
  return new Date(from.getTime() + RETENTION.revokedDeviceDays * DAY_MS);
}

export const TERMINAL_DEVICE_STATUSES: readonly DeviceStatus[] = [
  "REVOKED",
  "EXPIRED",
];
