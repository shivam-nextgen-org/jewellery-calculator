import { createHash, createHmac, randomBytes } from "node:crypto";

/** 32 bytes (256 bits) from the OS CSPRNG, base64url-encoded → 43 chars. */
const OPAQUE_TOKEN_BYTES = 32;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Unpredictable opaque credential (device secret, session id). Contains no PII. */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString("base64url");
}

/** Strict shape check. Anything else is rejected before it touches the DB. */
export function isOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_TOKEN_PATTERN.test(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Short, non-reversible reference derived from a credential hash. Safe to put
 * in logs and security events in place of a raw session id (ADR-017).
 */
export function safeReference(hashHex: string): string {
  return hashHex.slice(0, 16);
}

export const SAFE_REFERENCE_PATTERN = /^[a-f0-9]{16}$/;

/**
 * Keyed hash of an IP address so events never store the raw IP. The key is
 * derived from SESSION_SECRET with a fixed label, so no new env var is needed
 * and the IP hash can't be precomputed without the server secret.
 */
export function hashIp(
  ip: string | null | undefined,
  secret: string | undefined = process.env.SESSION_SECRET,
): string | null {
  const value = ip?.trim().toLowerCase();
  if (!value || value.length > 64 || !secret || secret.length < 16) {
    return null;
  }
  const key = createHmac("sha256", secret)
    .update("atelier/security/ip-hash/v1")
    .digest();
  return createHmac("sha256", key).update(value).digest("hex");
}
