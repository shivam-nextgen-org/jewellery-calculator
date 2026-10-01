/**
 * Whether auth cookies should be marked `secure`.
 * A `secure` cookie is DROPPED by the browser over plain HTTP — which breaks
 * login on phones hitting an http://IP or http://domain (no HTTPS). Default to
 * secure in production, but allow COOKIE_SECURE=false to disable it when the
 * app is served over HTTP (e.g. a VPS without TLS yet).
 *
 * Shared by the session cookie and the device cookie so both follow one policy.
 */
export function shouldUseSecureCookie(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return env.NODE_ENV === "production";
}
