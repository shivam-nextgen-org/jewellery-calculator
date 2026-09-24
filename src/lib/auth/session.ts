import { cookies } from "next/headers";
import { getApiKeySession } from "@/lib/auth/api-keys";
import {
  readSessionToken,
  REMEMBER_DAYS,
  SESSION_COOKIE,
  SESSION_DAYS,
  signSession,
  type SessionUser,
} from "@/lib/auth/token";

export type { SessionUser };
export { SESSION_COOKIE, readSessionToken, signSession };

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function createSession(user: SessionUser, remember = false) {
  const days = remember ? REMEMBER_DAYS : SESSION_DAYS;
  const token = await signSession(user, days);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: days * 24 * 60 * 60,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (session?.role === "USER") return session;
  const apiUser = await getApiKeySession();
  if (apiUser) return apiUser;
  throw new AuthError(
    session ? "Forbidden" : "Unauthorized",
    session ? 403 : 401,
  );
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await getSession();
  if (!session || session.role !== "SUPER_ADMIN") {
    throw new AuthError(
      session ? "Forbidden" : "Unauthorized",
      session ? 403 : 401,
    );
  }
  return session;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
