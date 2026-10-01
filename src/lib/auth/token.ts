import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "atelier_session";
export const SESSION_DAYS = 7;
export const REMEMBER_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "USER";
};

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (16+ characters)");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(
  user: SessionUser,
  days: number = SESSION_DAYS,
): Promise<string> {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(getSecret());
}

export type SessionClaims = {
  user: SessionUser;
  /** From the standard `iat` claim the token already carries. */
  issuedAt: Date | null;
};

/** Same verification as readSessionToken, also exposing `iat`. Token format is unchanged. */
export async function readSessionClaims(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.id !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      (payload.role !== "SUPER_ADMIN" && payload.role !== "USER")
    ) {
      return null;
    }
    return {
      user: {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      },
      issuedAt:
        typeof payload.iat === "number" ? new Date(payload.iat * 1000) : null,
    };
  } catch {
    return null;
  }
}

export async function readSessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  return (await readSessionClaims(token))?.user ?? null;
}
