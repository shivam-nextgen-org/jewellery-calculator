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

export function LogoutButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    // Close the confirm dialog first so only the full-screen loader shows,
    // exactly like the sign-in flow.
    setOpen(false);
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors — still redirect to login.
    }
    // Navigate to login. We intentionally skip router.refresh() here:
    // refresh() refetches the whole server component tree (re-running
    // getSession() in the layout), which is what made logout feel slow.
    router.replace("/login");
  }

  return (
    <>
      {busy && typeof document !== "undefined"
        ? createPortal(
            <PageLoader label="Logging out…" />,
            document.body,
          )
        : null}
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LogOut className="h-3.5 w-3.5" />
        Logout
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>
              You&apos;ll be signed out and returned to the login screen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={logout} disabled={busy}>
              {busy ? "Logging out…" : "Log out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
