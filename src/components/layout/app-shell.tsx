"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Scale,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import { LogoutDialog } from "@/components/layout/logout-button";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/token";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pricing", label: "Jewellery Pricing", icon: Scale },
];

const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
];

const ADMIN_SECURITY_NAV: NavItem = {
  href: "/admin/security",
  label: "Security",
  icon: ShieldCheck,
};

function initials(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function isActive(pathname: string, href: string) {
  // "/admin" is the dashboard root: match it exactly so it doesn't also light
  // up on /admin/users or /admin/security. Everything else matches by prefix.
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Avatar button with a small account menu (settings, sign out). */
function AccountMenu({
  user,
  isAdmin,
  onLogout,
}: {
  user: SessionUser;
  isAdmin: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-border/80 bg-surface py-1 pl-1 pr-2.5 text-left shadow-[0_1px_2px_rgba(26,24,22,0.04)] transition-colors hover:border-champagne-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-champagne-soft to-champagne text-xs font-semibold tracking-wide text-white">
          {initials(user.name)}
        </span>
        <span className="hidden leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-sm font-medium text-charcoal">{user.name}</span>
          <span className="block text-[11px] text-muted-foreground">{isAdmin ? "Administrator" : "Workspace"}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_12px_32px_-8px_rgba(26,24,22,0.18)]"
        >
          <div className="border-b border-border/70 px-4 py-3">
            <p className="truncate text-sm font-medium text-charcoal">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="p-1.5">
            {!isAdmin ? (
              <Link
                role="menuitem"
                href="/settings"
                prefetch
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-charcoal hover:bg-ivory-deep"
              >
                <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Settings &amp; rates
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/5"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({
  children,
  user,
  securityCenterEnabled = false,
}: {
  children: React.ReactNode;
  user: SessionUser | null;
  securityCenterEnabled?: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const isLogin = pathname === "/login";
  const isAdmin = user?.role === "SUPER_ADMIN";
  const nav: readonly NavItem[] = isAdmin
    ? securityCenterEnabled
      ? [...ADMIN_NAV, ADMIN_SECURITY_NAV]
      : ADMIN_NAV
    : NAV;

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-full flex-col" suppressHydrationWarning>
      <header className="sticky top-0 z-40">
        {/* Brand accent line */}
        <div className="h-[3px] bg-gradient-to-r from-champagne-muted via-champagne to-champagne-muted" aria-hidden="true" />
        <div className="border-b border-border/70 bg-surface-elevated/85 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-8">
              <Link
                href={isAdmin ? "/admin" : "/dashboard"}
                className="flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/50"
                onClick={() => setMobileOpen(false)}
              >
                <DiamondRingMark size={38} />
                <span className="leading-none">
                  <span className="block font-display text-[22px] font-medium tracking-tight text-charcoal">
                    Atelier<span className="text-champagne">.</span>
                  </span>
                  <span className="mt-1 hidden text-[10px] font-medium uppercase tracking-[0.22em] text-champagne sm:block">
                    Jewellery pricing studio
                  </span>
                </span>
              </Link>

              {nav.length > 0 ? (
                <nav aria-label="Main" className="hidden items-center gap-1 rounded-full border border-border/70 bg-ivory-deep/70 p-1 md:flex">
                  {nav.map((item) => {
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all",
                          active
                            ? "bg-surface text-charcoal shadow-[0_1px_3px_rgba(26,24,22,0.10)]"
                            : "text-charcoal-muted hover:text-charcoal",
                        )}
                      >
                        <Icon className={cn("h-4 w-4", active ? "text-champagne" : "opacity-60")} aria-hidden="true" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {user ? (
                <AccountMenu user={user} isAdmin={isAdmin} onLogout={() => setLogoutOpen(true)} />
              ) : null}
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-charcoal hover:bg-ivory-deep md:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {mobileOpen ? (
            <nav aria-label="Main" className="border-t border-border/70 px-4 py-3 md:hidden">
              <div className="flex flex-col gap-1">
                {[...nav, ...(isAdmin ? [] : [{ href: "/settings", label: "Settings & rates", icon: Settings } as NavItem])].map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                        active ? "bg-charcoal text-ivory" : "text-charcoal-muted hover:bg-ivory-deep",
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </nav>
          ) : null}
        </div>
      </header>

      <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} />

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        {children}
      </main>
    </div>
  );
}
