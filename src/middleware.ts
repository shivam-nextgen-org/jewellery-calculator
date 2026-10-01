import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth/token";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

function isPublic(pathname: string) {
  return PUBLIC_PATHS.has(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/tessdata") ||
    // Static assets served from /public (e.g. loader.mp4, *.svg, images).
    // Anything with a file extension is not an app page, so skip auth.
    /\.[a-zA-Z0-9]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const session = await readSessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  const authHeader = request.headers.get("authorization");
  const bearer =
    authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
  const apiKeyHeader = request.headers.get("x-api-key")?.trim() || "";
  const apiKey = apiKeyHeader || bearer;
  const hasApiKey = apiKey.startsWith("atl_");
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isCronPath =
    pathname === "/api/gold-rate/update" ||
    pathname === "/api/silver-rate/update" ||
    pathname === "/api/fx-rates/update";
  const hasCronSecret =
    Boolean(cronSecret) && bearer === cronSecret && isCronPath;

  if (isPublic(pathname)) {
    if (session && pathname === "/login") {
      const dest =
        session.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
      return NextResponse.redirect(new URL(dest, request.url));
    }
    return NextResponse.next();
  }

  if (!session && hasCronSecret && isCronPath) {
    return NextResponse.next();
  }

  if (
    !session &&
    hasApiKey &&
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/admin")
  ) {
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (session.role === "SUPER_ADMIN") {
    const allowed =
      pathname === "/" ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/api/admin") ||
      pathname.startsWith("/api/auth");
    if (!allowed) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  if (
    session.role === "USER" &&
    (pathname.startsWith("/admin") || pathname.startsWith("/api/admin"))
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
