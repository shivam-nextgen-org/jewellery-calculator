"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/video-loader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Logout confirmation dialog. Controlled, so it can be opened from anywhere
 * (e.g. a menu item that closes itself) without unmounting the dialog.
 */
export function LogoutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    // Close the confirm dialog first so only the full-screen loader shows,
    // exactly like the sign-in flow.
    onOpenChange(false);
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors — still redirect to login.
    }
    // Skip router.refresh(): it refetches the whole server tree, which made
    // logout feel slow.
    router.replace("/login");
  }

  return (
    <>
      {busy && typeof document !== "undefined"
        ? createPortal(<PageLoader label="Logging out…" />, document.body)
        : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[400px] gap-0 overflow-hidden rounded-2xl border-border/80 p-0 shadow-[0_24px_48px_-12px_rgba(26,24,22,0.28)]">
          {/* Brand accent, matching the header */}
          <div
            className="h-[3px] bg-gradient-to-r from-champagne-muted via-champagne to-champagne-muted"
            aria-hidden="true"
          />
          <div className="px-7 pb-6 pt-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-champagne-muted/60 ring-8 ring-champagne-muted/25">
              <LogOut className="h-6 w-6 text-charcoal" aria-hidden="true" />
            </div>
            <DialogHeader className="mt-5 items-center text-center">
              <DialogTitle className="font-display text-2xl font-medium">
                Sign out of Atelier?
              </DialogTitle>
              <DialogDescription className="max-w-[280px] leading-relaxed">
                You&apos;ll return to the login screen. Your rates and
                settings stay saved.
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="gap-3 border-t border-border/70 bg-ivory-deep/50 px-7 py-4 sm:justify-stretch">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 rounded-xl bg-surface"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Stay signed in
            </Button>
            <Button
              type="button"
              className="h-11 flex-1 rounded-xl"
              onClick={logout}
              disabled={busy}
              autoFocus
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {busy ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LogoutButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LogOut className="h-3.5 w-3.5" />
        Logout
      </Button>
      <LogoutDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
