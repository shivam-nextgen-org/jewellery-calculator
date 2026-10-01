"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

type Account = {
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  restriction: {
    id: string;
    level: "HIGH" | "CRITICAL";
    reason: string;
    reasonCodes: string[];
    startedAt: string;
    expiresAt: string;
    reviewRequired: boolean;
  } | null;
  reviewSince: string | null;
};

const OUTCOMES: Record<string, string> = {
  REMOVED: "Restriction removed.",
  ALREADY_ENDED: "This restriction had already ended.",
  NOT_FOUND: "This restriction no longer exists.",
};

async function fetchAccounts(): Promise<{ ok: true; accounts: Account[] } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/security/restrictions", { cache: "no-store" });
    const data = (await res.json()) as { accounts?: Account[]; error?: string };
    if (!res.ok) return { ok: false, error: data.error || "Could not load restrictions" };
    return { ok: true, accounts: data.accounts ?? [] };
  } catch {
    return { ok: false, error: "Could not load restrictions" };
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** I6: restricted / review-flagged customers, with password-confirmed lift. */
export function RestrictionsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<Account | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchAccounts();
    if (result.ok) {
      setAccounts(result.accounts);
      setError(null);
    } else setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchAccounts();
      if (cancelled) return;
      if (result.ok) setAccounts(result.accounts);
      else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target?.restriction) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/admin/security/restrictions/${target.restriction.id}/lift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.userId, password, reason }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setTarget(null);
      setNotice(OUTCOMES[data.outcome ?? ""] ?? "Done.");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-border/70">
        <div>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">Restrictions</CardTitle>
          <CardDescription>
            Customers temporarily restricted or flagged for review by the risk engine.
            Restrictions end on their own at the time shown.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-md border border-emerald-600/25 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800">{notice}</p>
        ) : null}
        {!loading && accounts.length === 0 && !error ? (
          <p className="py-4 text-sm text-muted-foreground">No customers are restricted or flagged.</p>
        ) : null}
        <ul className="divide-y divide-border/70">
          {accounts.map((a) => (
            <li key={a.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm">
                <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-medium text-charcoal">
                    {a.customerName ?? "Customer"} <span className="font-normal text-muted-foreground">{a.customerEmail}</span>
                  </p>
                  {a.restriction ? (
                    <>
                      <p className="text-muted-foreground">
                        {a.restriction.reason} · since {when(a.restriction.startedAt)} · ends {when(a.restriction.expiresAt)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{a.restriction.level}</Badge>
                        {a.restriction.reasonCodes.map((code) => (
                          <Badge key={code} className="font-mono text-[11px]">{code}</Badge>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Flagged for review since {when(a.reviewSince!)} · not restricted</p>
                  )}
                </div>
              </div>
              {a.restriction ? (
                <Button type="button" size="sm" variant="outline" onClick={() => { setTarget(a); setReason(""); setFormError(null); }}>
                  Remove restriction
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) { setTarget(null); setPassword(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove restriction?</DialogTitle>
            <DialogDescription>
              {target?.customerEmail}. Device approvals and the one-session limit stay in place.
              Re-enter your password to confirm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {formError ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{formError}</p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="restriction-reason">Reason</Label>
              <Input id="restriction-reason" value={reason} maxLength={300} required onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restriction-password">Your password</Label>
              <PasswordInput id="restriction-password" autoComplete="current-password" value={password} required onChange={(e) => setPassword(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !password || !reason.trim()}>{busy ? "Confirming…" : "Remove"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
