"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { MonitorSmartphone, RefreshCw } from "lucide-react";
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

type PendingDevice = {
  id: string;
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  referenceCode: string;
  platform: string | null;
  browserFamily: string | null;
  requestedAt: string;
  expiresAt: string;
};

type Decision = { device: PendingDevice; kind: "approve" | "reject" };

const OUTCOME_MESSAGES: Record<string, string> = {
  TRUSTED: "Device approved.",
  REJECTED: "Device rejected.",
  ALREADY_TRUSTED: "This device was already approved.",
  ALREADY_REJECTED: "This device was already rejected.",
  EXPIRED: "This request has expired and can no longer be approved.",
  REVOKED: "The customer removed this device.",
  NOT_FOUND: "This request no longer exists.",
};

async function fetchQueue(): Promise<
  { ok: true; devices: PendingDevice[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/admin/security/devices/pending", { cache: "no-store" });
    const data = (await res.json()) as { devices?: PendingDevice[]; error?: string };
    if (!res.ok) return { ok: false, error: data.error || "Could not load pending devices" };
    return { ok: true, devices: data.devices ?? [] };
  } catch {
    return { ok: false, error: "Could not load pending devices" };
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * I3 approval queue. Every decision requires the admin to re-enter their
 * password (server-side step-up); nothing here is trusted by the server.
 */
export function PendingDevicesPanel() {
  const [devices, setDevices] = useState<PendingDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchQueue();
    if (result.ok) {
      setDevices(result.devices);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchQueue();
      if (cancelled) return;
      if (result.ok) setDevices(result.devices);
      else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function open(device: PendingDevice, kind: Decision["kind"]) {
    setDecision({ device, kind });
    setPassword("");
    setReason("");
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!decision) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(
        `/api/admin/security/devices/${decision.device.id}/${decision.kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: decision.device.userId,
            password,
            reason: reason || undefined,
          }),
        },
      );
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok && !data.outcome) throw new Error(data.error || "Request failed");
      setPassword("");
      setDecision(null);
      setNotice(OUTCOME_MESSAGES[data.outcome ?? ""] ?? "Done.");
      await load();
    } catch (err) {
      setPassword("");
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 border-b border-border/70">
        <div>
          <CardTitle className="font-sans text-lg font-semibold tracking-tight">
            Device approvals
          </CardTitle>
          <CardDescription>
            New devices wait here for up to 24 hours. Confirm the reference code
            with the customer before approving.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-md border border-emerald-600/25 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {!loading && devices.length === 0 && !error ? (
          <p className="py-4 text-sm text-muted-foreground">No devices are waiting for approval.</p>
        ) : null}
        <ul className="divide-y divide-border/70">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <MonitorSmartphone className="mt-0.5 h-5 w-5 text-champagne" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium text-charcoal">
                    {device.customerName ?? "Customer"}{" "}
                    <span className="font-normal text-muted-foreground">{device.customerEmail}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {[device.browserFamily, device.platform].filter(Boolean).join(" on ") || "Unknown browser"}
                    {" · "}requested {when(device.requestedAt)} · expires {when(device.expiresAt)}
                  </p>
                  <Badge className="mt-1 font-mono tracking-wider">{device.referenceCode}</Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => open(device, "approve")}>
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => open(device, "reject")}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog
        open={decision !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !busy) {
            setDecision(null);
            setPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decision?.kind === "approve" ? "Approve device?" : "Reject device?"}</DialogTitle>
            <DialogDescription>
              {decision?.device.customerEmail} · reference{" "}
              <span className="font-mono font-semibold">{decision?.device.referenceCode}</span>.
              Re-enter your password to confirm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {formError ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="device-decision-reason">
                Reason{decision?.kind === "reject" ? "" : " (optional)"}
              </Label>
              <Input
                id="device-decision-reason"
                value={reason}
                maxLength={300}
                required={decision?.kind === "reject"}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="device-decision-password">Your password</Label>
              <PasswordInput
                id="device-decision-password"
                autoComplete="current-password"
                value={password}
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDecision(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !password}>
                {busy ? "Confirming…" : decision?.kind === "approve" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
