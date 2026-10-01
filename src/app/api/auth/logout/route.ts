import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";
import { revokeSessionOnLogout } from "@/lib/security/logout";

export async function POST() {
  // I2: revoke the server session behind atelier_sid (no-op when sessions are off).
  await revokeSessionOnLogout(await cookies());
  await clearSession();
  return NextResponse.json({ ok: true });
}
