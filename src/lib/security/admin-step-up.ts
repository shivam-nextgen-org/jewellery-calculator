import type { Db } from "mongodb";
import { verifyPassword } from "@/lib/auth/password";
import { SECURITY_COLLECTIONS } from "@/lib/security/collections";
import { recordSecurityEvent } from "@/lib/security/events";
import { parseObjectId } from "@/lib/security/ids";

/**
 * Admin step-up for high-impact security actions (ADR-015 / G5).
 *
 * Launch mechanism: re-enter the admin password on every such action. No
 * step-up "session" is cached, so a stolen admin cookie alone can't approve
 * devices. Failures are counted in the database (SecurityEvent), so the limit
 * holds across processes; after STEP_UP_MAX_FAILURES within the window the
 * check refuses without calling bcrypt.
 *
 * This is re-authentication, not MFA. Admin MFA (TOTP / email OTP) is still
 * required before production enforcement (doc 07, Addendum A).
 */

export const STEP_UP_WINDOW_MINUTES = 15;
export const STEP_UP_MAX_FAILURES = 5;

export type StepUpResult = { ok: true } | { ok: false; status: 400 | 401 | 429 };

export async function verifyAdminStepUp(
  db: Db,
  adminId: string,
  password: unknown,
  context: { action: string; ip?: string | null },
  now: Date = new Date(),
): Promise<StepUpResult> {
  const id = parseObjectId(adminId);
  if (!id) return { ok: false, status: 401 };
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    return { ok: false, status: 400 };
  }

  const since = new Date(now.getTime() - STEP_UP_WINDOW_MINUTES * 60_000);
  const failures = await db.collection(SECURITY_COLLECTIONS.event).countDocuments({
    type: "ADMIN_STEP_UP_FAILED",
    actorId: id,
    occurredAt: { $gte: since },
  });
  if (failures >= STEP_UP_MAX_FAILURES) return { ok: false, status: 429 };

  const admin = await db
    .collection<{ role?: string; isActive?: boolean; passwordHash?: string }>("User")
    .findOne({ _id: id }, { projection: { role: 1, isActive: 1, passwordHash: 1 } });
  const valid =
    admin?.role === "SUPER_ADMIN" &&
    admin.isActive === true &&
    typeof admin.passwordHash === "string" &&
    (await verifyPassword(password, admin.passwordHash));

  await recordSecurityEvent(db, {
    type: valid ? "ADMIN_STEP_UP_SUCCEEDED" : "ADMIN_STEP_UP_FAILED",
    actorType: "ADMIN",
    actorId: id,
    ip: context.ip,
    reasonCodes: [context.action],
    occurredAt: now,
  });
  return valid ? { ok: true } : { ok: false, status: 401 };
}
