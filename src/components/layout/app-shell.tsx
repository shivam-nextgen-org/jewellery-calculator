"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  History,
  LayoutDashboard,
  Menu,
  Package,
  Scale,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import { LogoutButton } from "@/components/layout/logout-button";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/auth/token";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pricing", label: "Jewellery Pricing", icon: Scale },
  { href: "/products", label: "Products", icon: Package },
  { href: "/history", label: "History", icon: History },
] as const;

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: SessionUser | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isLogin = pathname === "/login";
  const isAdmin = user?.role === "SUPER_ADMIN";
  const settingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-full flex-col" suppressHydrationWarning>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-ivory/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link
              href={isAdmin ? "/admin" : "/dashboard"}
              className="group flex items-center gap-2.5"
              onClick={() => setOpen(false)}
            >
              <span className="flex h-11 w-11 items-center justify-center">
                <DiamondRingMark size={44} />
              </span>
              <span className="font-display text-xl font-medium tracking-tight text-charcoal">
                Atelier<span className="text-champagne">.</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {(isAdmin ? [] : NAV).map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-charcoal text-ivory"
                        : "text-charcoal-muted hover:bg-ivory-deep hover:text-charcoal",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 opacity-70" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {user ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {user.name}
              </span>
            ) : null}
            {!isAdmin ? (
              <Link
                href="/settings"
                prefetch
                className={cn(
                  "hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors md:inline-flex",
                  settingsActive
                    ? "bg-ivory-deep text-charcoal"
                    : "text-charcoal-muted hover:bg-ivory-deep hover:text-charcoal",
                )}
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Link>
            ) : null}
            <LogoutButton />
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? <X /> : <Menu />}
            </Button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-border/70 bg-surface px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {(isAdmin ? [] : NAV).map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    onClick={() => setOpen(false)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium",
                      active
                        ? "bg-charcoal text-ivory"
                        : "text-charcoal-muted hover:bg-ivory-deep",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              {!isAdmin ? (
                <Link
                  href="/settings"
                  prefetch
                  onClick={() => setOpen(false)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium",
                    settingsActive
                      ? "bg-charcoal text-ivory"
                      : "text-charcoal-muted hover:bg-ivory-deep",
                  )}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              ) : null}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
