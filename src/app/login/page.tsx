"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Calculator,
  FileSpreadsheet,
  Loader2,
  Lock,
  Mail,
  ScanText,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import { PageLoader } from "@/components/brand/video-loader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

const HIGHLIGHTS = [
  {
    icon: TrendingUp,
    title: "Live gold and silver rates",
    text: "Benchmark rates refresh every morning, so quotes start from today's market.",
  },
  {
    icon: ScanText,
    title: "Design sheets to data",
    text: "Upload a design sheet and pick up weights, stones and purity automatically.",
  },
  {
    icon: FileSpreadsheet,
    title: "Every variation, priced",
    text: "Price each metal, purity and stone combination and export it to Excel.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // Clear the fields only when the page is actually restored from the
  // back/forward cache (event.persisted). Firing on every pageshow could wipe
  // what the user is typing on mobile browsers.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setEmail("");
        setPassword("");
        setError(null);
        setSubmitting(false);
        setRedirecting(false);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
      };
      if (!res.ok) throw new Error(data.error || "We couldn't sign you in. Please try again.");
      // Navigate to the destination. We skip router.refresh() here: refresh()
      // forces an extra full server re-render of the tree, which noticeably
      // slowed the post-login landing (especially the dashboard).
      setRedirecting(true);
      router.replace(data.redirect ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't sign you in. Please try again.");
      setPassword("");
      setSubmitting(false);
    }
  }

  const year = new Date().getFullYear();

  return (
    <>
      {redirecting ? <PageLoader label="Opening your workspace…" /> : null}

      <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Brand panel (large screens) */}
        <aside className="relative hidden overflow-hidden bg-charcoal text-ivory lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          <div
            className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-champagne/25 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-champagne-soft/10 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-champagne-soft via-champagne to-amber-300"
            aria-hidden="true"
          />

          <div className="relative flex items-center gap-3">
            <DiamondRingMark size={44} />
            <span className="font-display text-2xl font-medium tracking-tight">
              Atelier<span className="text-champagne">.</span>
            </span>
          </div>

          <div className="relative max-w-lg">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-champagne-soft">
              Jewellery pricing workspace
            </p>
            <h2 className="mt-3 font-display text-4xl font-medium leading-tight tracking-tight xl:text-5xl">
              Accurate quotes, from design sheet to price list.
            </h2>
            <ul className="mt-10 space-y-6">
              {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ivory/10 bg-ivory/5 text-champagne-soft">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ivory">{title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-ivory/65">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-ivory/45">© {year} Atelier. All rights reserved.</p>
        </aside>

        {/* Sign-in panel */}
        <main className="relative flex flex-col items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[420px]">
            {/* Compact brand for small screens */}
            <div className="mb-8 flex flex-col items-center text-center lg:hidden">
              <DiamondRingMark size={72} />
              <span className="mt-3 font-display text-2xl font-medium tracking-tight text-charcoal">
                Atelier<span className="text-champagne">.</span>
              </span>
            </div>

            <div className="rounded-2xl border border-border/80 bg-surface p-6 shadow-[0_24px_48px_-24px_rgba(26,24,22,0.18)] sm:p-8">
              <div className="mb-6">
                <span className="mb-4 hidden h-11 w-11 items-center justify-center rounded-xl bg-champagne-muted/70 text-charcoal lg:flex">
                  <Calculator className="h-5 w-5" aria-hidden="true" />
                </span>
                <h1 className="font-display text-2xl font-medium tracking-tight text-charcoal sm:text-[28px]">
                  Welcome back
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Sign in with the email and password your administrator gave you.
                </p>
              </div>

              <form onSubmit={onSubmit} autoComplete="off" className="space-y-5">
                {error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={submitting}
                      required
                      autoFocus
                      className="h-11 pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <PasswordInput
                      id="password"
                      autoComplete="new-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={trackCapsLock}
                      onKeyDown={trackCapsLock}
                      onBlur={() => setCapsLock(false)}
                      disabled={submitting}
                      required
                      aria-describedby={capsLock ? "caps-lock-hint" : undefined}
                      className="h-11 pl-10"
                    />
                  </div>
                  {capsLock ? (
                    <p id="caps-lock-hint" className="text-xs font-medium text-amber-700" aria-live="polite">
                      Caps Lock is on.
                    </p>
                  ) : null}
                </div>

                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-charcoal-muted">
                  <Checkbox
                    checked={remember}
                    disabled={submitting}
                    onCheckedChange={(value) => setRemember(value === true)}
                  />
                  Keep me signed in for 30 days
                </label>

                <Button type="submit" size="lg" className="h-11 w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 border-t border-border/70 pt-5 text-center text-xs text-muted-foreground">
                Forgot your password or need an account? Contact your administrator.
              </div>
            </div>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-champagne" aria-hidden="true" />
              Secure sign-in. Only use this on devices you trust.
            </p>
            <p className="mt-2 text-center text-xs text-muted-foreground/80 lg:hidden">
              © {year} Atelier
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
