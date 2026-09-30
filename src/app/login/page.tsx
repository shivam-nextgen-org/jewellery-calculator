"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import { PageLoader } from "@/components/brand/video-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Clear the fields only when the page is actually restored from the
  // back/forward cache (event.persisted). Firing on every pageshow could wipe
  // what the user is typing on mobile browsers.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setEmail("");
        setPassword("");
        setError(null);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = (await res.json()) as {
        error?: string;
        redirect?: string;
      };
      if (!res.ok) throw new Error(data.error || "Login failed");
      // Navigate to the destination. We skip router.refresh() here: refresh()
      // forces an extra full server re-render of the tree, which noticeably
      // slowed the post-login landing (especially the dashboard).
      router.replace(data.redirect ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setSaving(false);
    }
  }

  return (
    <>
      {saving ? <PageLoader label="Signing in…" /> : null}
      <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-28 w-28 items-center justify-center">
            <DiamondRingMark size={112} />
          </span>
          <h1 className="mt-4 font-display text-3xl font-medium tracking-tight text-charcoal">
            Atelier<span className="text-champagne">.</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your jewellery pricing workspace.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          autoComplete="off"
          className="space-y-4 rounded-xl border border-border/80 bg-surface p-6 shadow-sm"
        >
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-charcoal-muted">
            <Checkbox
              checked={remember}
              onCheckedChange={(value) => setRemember(value === true)}
            />
            Remember me for 30 days
          </label>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
    </>
  );
}
