import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getDb, idOf, type ObjectId } from "@/lib/mongo";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { consumeLoginAttempt } from "@/lib/auth/rate-limit";
import { runAfterResponse } from "@/lib/security/background";
import { getSecurityConfig } from "@/lib/security/config";
import { DEVICE_COOKIE } from "@/lib/security/device";
import { normalizeCountry, recordSecurityEvent } from "@/lib/security/events";
import { evaluateCustomerRiskSafely } from "@/lib/security/risk";
import {
  applyLoginSecurity,
  loginSecurityGate,
  setLoginSecurityCookies,
  type LoginSecurityResult,
} from "@/lib/security/login";

type UserRow = {
  _id: ObjectId;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "USER";
  passwordHash: string;
  isActive: boolean;
};

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (!consumeLoginAttempt(ip)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    remember?: boolean;
  } | null;

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const remember = body?.remember === true;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  let user: UserRow | null;
  let db: Db;
  try {
    db = await getDb();
    user = (await db
      .collection("User")
      .findOne(
        { email },
        {
          projection: {
            email: 1,
            name: 1,
            role: 1,
            passwordHash: 1,
            isActive: 1,
          },
        },
      )) as UserRow | null;
  } catch (error) {
    console.error("[login] database error:", error);
    return NextResponse.json(
      { error: "Cannot reach the database. Please try again." },
      { status: 503 },
    );
  }

  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  const securityConfig = getSecurityConfig();
  if (user && !valid && user.role === "USER" && securityConfig.flags.riskEngine !== "off") {
    // I5: wrong password for an existing customer is a risk signal. Recorded
    // after the response, so timing and the response are unchanged.
    const userId = idOf(user._id);
    runAfterResponse(async () => {
      await recordSecurityEvent(db, {
        type: "LOGIN_FAILED",
        actorType: "USER",
        actorId: userId,
        userId,
        ip,
        reasonCodes: ["INVALID_PASSWORD"],
      });
      await evaluateCustomerRiskSafely(db, userId, securityConfig);
    });
  }
  if (!user || !valid) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }
  if (!user.isActive) {
    return NextResponse.json(
      { error: "This account is disabled." },
      { status: 403 },
    );
  }

  // Additive security layer (I2): device registration + server session.
  // No-op while SECURITY_DEVICE_TRUST_ENABLED=off (default).
  const jar = await cookies();
  const coarseGeo =
    securityConfig.flags.trustedGeoHeader === "on"
      ? normalizeCountry(request.headers.get("cf-ipcountry"))
      : null;
  let security: LoginSecurityResult | "error";
  try {
    security = await applyLoginSecurity(
      db,
      {
        userId: idOf(user._id),
        role: user.role,
        rememberMe: remember,
        deviceCookie: jar.get(DEVICE_COOKIE)?.value ?? null,
        userAgent: request.headers.get("user-agent"),
        ip,
        coarseGeo,
      },
      securityConfig,
    );
  } catch {
    security = "error";
  }
  // I5: re-evaluate risk from the events this login produced (after the
  // response; fail-open; advisory only).
  if (user.role === "USER" && securityConfig.flags.riskEngine !== "off") {
    const userId = idOf(user._id);
    runAfterResponse(() => evaluateCustomerRiskSafely(db, userId, securityConfig));
  }
  // Cookies first: a newly registered device keeps its cookie even if the
  // login is then refused, so a retry reuses it instead of using a new slot.
  setLoginSecurityCookies(jar, security, remember, securityConfig);
  const gate = loginSecurityGate(security, securityConfig);
  if (gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  await createSession(
    {
      id: idOf(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
    },
    remember,
  );

  const pendingDevice =
    security !== "error" && security.kind === "ok" ? security.pendingDevice : null;
  return NextResponse.json({
    role: user.role,
    name: user.name,
    redirect: user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard",
    // I3: only present when this browser is waiting for approval.
    ...(pendingDevice ? { device: { status: "PENDING_APPROVAL", ...pendingDevice } } : {}),
  });
}
