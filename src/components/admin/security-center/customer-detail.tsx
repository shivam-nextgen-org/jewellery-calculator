"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  LogOut,
  MonitorSmartphone,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { BackLink, SectionHeading } from "@/components/ui/page-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";
import type { CustomerSecurityDetail } from "@/lib/security/admin-security-center";

type Detail = NonNullable<CustomerSecurityDetail>;

type PendingAction = {
  action: string;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  /** Extra inputs shown in the dialog. */
  extra?: "label" | "limits" | "level";
  reasonOptional?: boolean;
};

const OUTCOME_TEXT: Record<string, string> = {
  TRUSTED: "Device approved.",
  REJECTED: "Device rejected.",
  REVOKED: "Done.",
  RENAMED: "Device renamed.",
  LOGGED_OUT: "All sessions ended.",
  CLEARED: "Review flag cleared.",
  RESTRICTED: "Restriction applied.",
  REMOVED: "Restriction removed.",
  UPDATED: "Limits updated.",
};

const RISK_TONE: Record<string, string> = {
  LOW: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  MEDIUM: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  HIGH: "border-destructive/25 bg-destructive/10 text-destructive",
  CRITICAL: "border-destructive/40 bg-destructive/15 text-destructive",
};

const STATE_TONE: Record<string, string> = {
  ACTIVE: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  REVIEW_REQUIRED: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  RESTRICTED: "border-destructive/25 bg-destructive/10 text-destructive",
  DISABLED: "border-destructive/25 bg-destructive/10 text-destructive",
};

function when(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchDetail(
  userId: string,
): Promise<{ ok: true; detail: Detail } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/admin/security/customers/${userId}`, {
      cache: "no-store",
    });
    const data = (await res.json()) as Detail & { error?: string };
    if (!res.ok) return { ok: false, error: data.error || "Could not load customer" };
    return { ok: true, detail: data };
  } catch {
    return { ok: false, error: "Could not load customer" };
  }
}

const Codes = ({ codes }: { codes: string[] }) => (
  <span className="flex flex-wrap gap-1">
    {codes.map((c) => (
      <Badge key={c} className="font-mono text-[11px]">
        {c}
      </Badge>
    ))}
  </span>
);

/** A labelled card used inside a tab panel. */
function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-border/70">
        <SectionHeading title={title} description={description} actions={actions} />
      </CardHeader>
      <CardContent className="pt-4 text-sm">{children}</CardContent>
    </Card>
  );
}

/** Small metric tile for the summary strip. */
function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-surface p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tracking-tight",
          tone === "warning" ? "text-destructive" : "text-charcoal",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** I7: one customer's full security picture, organised into tabs. */
export function CustomerSecurityDetailView({ userId }: { userId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [deviceLimit, setDeviceLimit] = useState("");
  const [sessionLimit, setSessionLimit] = useState("");
  const [level, setLevel] = useState<"HIGH" | "CRITICAL">("HIGH");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const result = await fetchDetail(userId);
    if (result.ok) {
      setDetail(result.detail);
      setError(null);
    } else setError(result.error);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchDetail(userId);
      if (cancelled) return;
      if (result.ok) setDetail(result.detail);
      else setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function open(action: PendingAction) {
    setPending(action);
    setPassword("");
    setReason("");
    setFormError(null);
    if (action.extra === "limits" && detail) {
      setDeviceLimit(String(detail.status.limits.deviceLimitOverride ?? ""));
      setSessionLimit(String(detail.status.limits.maxConcurrentSessionsOverride ?? ""));
    }
    if (action.extra === "label") setLabel(String(action.payload.currentLabel ?? ""));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    setBusy(true);
    setFormError(null);
    const payload: Record<string, unknown> = { ...pending.payload };
    delete payload.currentLabel;
    if (pending.extra === "label") payload.label = label;
    if (pending.extra === "level") payload.level = level;
    if (pending.extra === "limits") {
      payload.deviceLimit = deviceLimit.trim() === "" ? null : Number(deviceLimit);
      payload.maxConcurrentSessions =
        sessionLimit.trim() === "" ? null : Number(sessionLimit);
    }
    try {
      const res = await fetch(`/api/admin/security/customers/${userId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pending.action,
          password,
          reason: reason || undefined,
          ...payload,
        }),
      });
      const data = (await res.json()) as {
        outcome?: string;
        applied?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setPending(null);
      setNotice(
        data.applied
          ? OUTCOME_TEXT[data.outcome ?? ""] ?? "Done."
          : `No change: ${String(data.outcome ?? "")
            .toLowerCase()
            .replace(/_/g, " ")}.`,
      );
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <BackLink href="/admin/security">All customers</BackLink>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-6">
        <BackLink href="/admin/security">All customers</BackLink>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const { customer, status, risk, restrictions, devices, sessions, events, adminActions } =
    detail;
  const activeSessions = sessions.filter((s) => s.status === "ACTIVE");
  const pendingDevices = devices.filter(
    (d) => d.status === "PENDING_VERIFICATION",
  ).length;
  const trustedDevices = devices.filter((d) => d.status === "TRUSTED").length;
  const stateLabel = status.accountState.replace(/_/g, " ");

  // Attention chips: the few things an admin must notice immediately.
  const attention: { key: string; label: string; tone: "warn" | "danger" }[] = [];
  if (pendingDevices > 0)
    attention.push({
      key: "pending",
      label: `${pendingDevices} device${pendingDevices > 1 ? "s" : ""} awaiting approval`,
      tone: "warn",
    });
  if (restrictions.active)
    attention.push({
      key: "restricted",
      label: `Restricted (${restrictions.active.level}) until ${when(restrictions.active.expiresAt)}`,
      tone: "danger",
    });
  if (risk.review)
    attention.push({ key: "review", label: "Flagged for review", tone: "warn" });

  const limitActions = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          open({
            action: "LIMITS_SET",
            title: "Change limits",
            description: `Whole numbers ${status.limits.bounds.min}–${status.limits.bounds.max}. Leave empty for the default. Lowering the session limit ends the oldest sessions beyond it; lowering the device limit removes no devices.`,
            payload: {},
            extra: "limits",
          })
        }
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Change limits
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={activeSessions.length === 0}
        onClick={() =>
          open({
            action: "FORCE_LOGOUT",
            title: "Force logout?",
            description:
              "Ends every active session for this customer. Devices stay trusted.",
            payload: {},
          })
        }
      >
        <LogOut className="h-3.5 w-3.5" />
        Force logout
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Identity + highlighted status */}
      <div className="flex flex-col gap-3">
        <BackLink href="/admin/security">All customers</BackLink>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-charcoal">
                {customer.name ?? "Customer"}
              </h1>
              <Badge className={cn("border", STATE_TONE[status.accountState] ?? "")}>
                {stateLabel}
              </Badge>
              <Badge className={cn("border", RISK_TONE[risk.current?.tier ?? "LOW"])}>
                Risk {risk.current?.tier ?? "LOW"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{customer.email}</p>
          </div>
        </div>

        {attention.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {attention.map((a) => (
              <span
                key={a.key}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  a.tone === "danger"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700",
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {a.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {notice ? (
        <p
          role="status"
          className="rounded-md border border-emerald-600/25 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800"
        >
          {notice}
        </p>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList>
          <TabsTrigger value="overview">
            <ShieldAlert className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="devices">
            <MonitorSmartphone className="h-3.5 w-3.5" />
            Devices{devices.length ? ` (${devices.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions{activeSessions.length ? ` (${activeSessions.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="risk">Risk &amp; restrictions</TabsTrigger>
          <TabsTrigger value="activity">
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
        </TabsList>

        {/* ---- Overview ---- */}
        <TabsContent value="overview" className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Account" value={stateLabel} />
            <Stat
              label="Risk"
              value={risk.current?.tier ?? "LOW"}
              sub={risk.current ? `score ${risk.current.score}` : "no risk detected"}
            />
            <Stat
              label="Devices"
              value={`${trustedDevices} trusted`}
              sub={
                pendingDevices > 0
                  ? `${pendingDevices} pending approval`
                  : `${status.deviceSlotsUsed} of ${status.limits.deviceLimit} slots`
              }
              tone={pendingDevices > 0 ? "warning" : "default"}
            />
            <Stat
              label="Active sessions"
              value={activeSessions.length}
              sub={`limit ${status.limits.maxConcurrentSessions}`}
            />
          </div>

          <Panel
            title="Access & limits"
            description="Per-customer device and session limits, and session controls."
            actions={limitActions}
          >
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">First device enrolled</dt>
                <dd>{when(status.enrolledAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Device limit</dt>
                <dd>
                  {status.limits.deviceLimit}{" "}
                  {status.limits.deviceLimitOverride === null ? "(default)" : "(custom)"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Session limit</dt>
                <dd>
                  {status.limits.maxConcurrentSessions}{" "}
                  {status.limits.maxConcurrentSessionsOverride === null
                    ? "(default)"
                    : "(custom)"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Device slots used</dt>
                <dd>
                  {status.deviceSlotsUsed} of {status.limits.deviceLimit}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last forced logout</dt>
                <dd>{when(status.sessionsValidAfter)}</dd>
              </div>
            </dl>
          </Panel>
        </TabsContent>

        {/* ---- Devices ---- */}
        <TabsContent value="devices">
          <Panel title="Devices">
            {devices.length === 0 ? (
              <p className="text-muted-foreground">No devices registered.</p>
            ) : null}
            <ul className="divide-y divide-border/70">
              {devices.map((d) => {
                const name =
                  d.label ??
                  ([d.browserFamily, d.platform].filter(Boolean).join(" on ") ||
                    "Device");
                const usable =
                  d.status === "TRUSTED" || d.status === "PENDING_VERIFICATION";
                return (
                  <li
                    key={d.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">
                        {name} <Badge>{d.status.replace(/_/g, " ")}</Badge>
                        {d.referenceCode ? (
                          <Badge className="ml-1 font-mono">{d.referenceCode}</Badge>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground">
                        First seen {when(d.firstSeenAt)} · last seen {when(d.lastSeenAt)}
                        {d.pendingExpiresAt
                          ? ` · approval expires ${when(d.pendingExpiresAt)}`
                          : ""}
                        {d.revokedReason
                          ? ` · ${d.revokedReason.replace(/_/g, " ").toLowerCase()}`
                          : ""}
                      </p>
                    </div>
                    {usable ? (
                      <div className="flex flex-wrap gap-2">
                        {d.status === "PENDING_VERIFICATION" ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                open({
                                  action: "DEVICE_APPROVE",
                                  title: "Approve device?",
                                  description: `Confirm reference ${d.referenceCode} with the customer first.`,
                                  payload: { deviceId: d.id },
                                  reasonOptional: true,
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                open({
                                  action: "DEVICE_REJECT",
                                  title: "Reject device?",
                                  description:
                                    "The device can't be used and its slot is freed.",
                                  payload: { deviceId: d.id },
                                })
                              }
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            open({
                              action: "DEVICE_RENAME",
                              title: "Rename device",
                              description: "Up to 40 characters.",
                              payload: { deviceId: d.id, currentLabel: d.label ?? "" },
                              extra: "label",
                              reasonOptional: true,
                            })
                          }
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            open({
                              action: "DEVICE_REVOKE",
                              title: "Revoke device?",
                              description:
                                "Ends its sessions and frees its slot. The device must be approved again to be used.",
                              payload: { deviceId: d.id },
                            })
                          }
                        >
                          Revoke
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </TabsContent>

        {/* ---- Sessions ---- */}
        <TabsContent value="sessions">
          <Panel
            title="Sessions"
            description="Session references are short non-reversible codes, not session ids."
            actions={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={activeSessions.length === 0}
                onClick={() =>
                  open({
                    action: "FORCE_LOGOUT",
                    title: "Force logout?",
                    description:
                      "Ends every active session for this customer. Devices stay trusted.",
                    payload: {},
                  })
                }
              >
                <LogOut className="h-3.5 w-3.5" />
                Force logout
              </Button>
            }
          >
            {sessions.length === 0 ? (
              <p className="text-muted-foreground">No sessions.</p>
            ) : null}
            <ul className="divide-y divide-border/70">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {s.deviceLabel} <Badge>{s.status}</Badge>{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {s.ref}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      Started {when(s.createdAt)} · last active {when(s.lastActivityAt)}
                      {s.revokedReason
                        ? ` · ended: ${s.revokedReason.replace(/_/g, " ").toLowerCase()}`
                        : ` · expires ${when(s.expiresAt)}`}
                    </p>
                  </div>
                  {s.status === "ACTIVE" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        open({
                          action: "SESSION_REVOKE",
                          title: "End this session?",
                          description:
                            "The customer is signed out on that device. The device stays trusted.",
                          payload: { sessionId: s.id },
                        })
                      }
                    >
                      End session
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </TabsContent>

        {/* ---- Risk & restrictions ---- */}
        <TabsContent value="risk" className="space-y-5">
          <Panel
            title="Risk"
            description="Current level and why. Assessments are advisory unless restrictions are enabled."
          >
            {risk.current ? (
              <div className="space-y-2">
                <p>
                  <span className="font-medium">{risk.current.tier}</span> · score{" "}
                  {risk.current.score} · recommended {risk.current.recommendedAction} ·{" "}
                  {when(risk.current.evaluatedAt)}
                </p>
                <Codes codes={risk.current.reasonCodes} />
              </div>
            ) : (
              <p className="text-muted-foreground">No risk detected.</p>
            )}
            {risk.review ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
                <span>
                  Review required since {when(risk.review.since)} (
                  {risk.review.source === "RISK_CRITICAL" ? "critical risk" : "medium risk"})
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    open({
                      action: "REVIEW_CLEAR",
                      title: "Clear review flag?",
                      description:
                        "Marks this account as reviewed. An active restriction stays in place; only new activity can flag it again.",
                      payload: {},
                    })
                  }
                >
                  Clear review
                </Button>
              </div>
            ) : null}
            {risk.history.length > 0 ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-muted-foreground">
                  Assessment history ({risk.history.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {risk.history.map((h) => (
                    <li key={h.id} className="rounded-md border border-border/70 px-3 py-2">
                      <p>
                        {when(h.evaluatedAt)} · {h.previousTier ?? "—"} →{" "}
                        <span className="font-medium">{h.tier}</span> · score {h.score} ·{" "}
                        {h.mode}
                      </p>
                      <ul className="mt-1 text-xs text-muted-foreground">
                        {h.contributions.map((c) => (
                          <li key={c.code}>
                            <span className="font-mono">{c.code}</span>: {c.value}{" "}
                            (threshold {c.threshold}) +{c.weight}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Panel>

          <Panel
            title="Restrictions"
            description="Every restriction ends on its own; nothing here is permanent."
            actions={
              restrictions.active ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    open({
                      action: "RESTRICTION_LIFT",
                      title: "Remove restriction?",
                      description:
                        "Restores access now. Device approvals and the session limit stay in place.",
                      payload: { restrictionId: restrictions.active!.id },
                    })
                  }
                >
                  Remove restriction
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!customer.isActive}
                  onClick={() =>
                    open({
                      action: "RESTRICTION_CREATE",
                      title: "Restrict temporarily?",
                      description:
                        "HIGH blocks access for the configured period. CRITICAL blocks until reviewed, up to the configured maximum.",
                      payload: {},
                      extra: "level",
                    })
                  }
                >
                  Restrict temporarily
                </Button>
              )
            }
          >
            {restrictions.active ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
                <span>
                  Active <Badge>{restrictions.active.level}</Badge> until{" "}
                  {when(restrictions.active.expiresAt)}
                </span>
              </div>
            ) : (
              <p className="text-muted-foreground">No active restriction.</p>
            )}
            {restrictions.history.length > 0 ? (
              <ul className="mt-4 divide-y divide-border/70">
                {restrictions.history.map((r) => (
                  <li key={r.id} className="py-2">
                    <p>
                      <Badge>{r.level}</Badge>{" "}
                      <span className="font-medium">{r.status}</span> ·{" "}
                      {r.source === "ADMIN" ? `by ${r.createdBy}` : "risk engine"} ·{" "}
                      {when(r.startedAt)} → {when(r.endedAt ?? r.expiresAt)}
                    </p>
                    <p className="text-muted-foreground">
                      {r.reason}
                      {r.removedBy
                        ? ` · removed by ${r.removedBy}: ${r.removalReason}`
                        : ""}
                    </p>
                    <Codes codes={r.reasonCodes} />
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        </TabsContent>

        {/* ---- Activity ---- */}
        <TabsContent value="activity" className="space-y-5">
          <Panel title="Admin actions" description="Who did what to this account, and why.">
            {adminActions.length === 0 ? (
              <p className="text-muted-foreground">No admin actions recorded.</p>
            ) : null}
            <ul className="space-y-1">
              {adminActions.map((a) => (
                <li key={a.id}>
                  {when(a.occurredAt)} ·{" "}
                  <span className="font-mono text-xs">{a.action}</span> · {a.admin} ·{" "}
                  <span className="text-muted-foreground">{a.reason}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Security events"
            description="Network references are short hashes; raw IP addresses are never stored."
          >
            {events.length === 0 ? (
              <p className="text-muted-foreground">No security events.</p>
            ) : null}
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <span>{when(e.occurredAt)}</span>
                  <span className="font-mono text-xs">{e.type}</span>
                  <span className="text-muted-foreground">{e.actorType.toLowerCase()}</span>
                  {e.networkRef ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      net {e.networkRef}
                    </span>
                  ) : null}
                  {e.country ? (
                    <span className="text-xs text-muted-foreground">{e.country}</span>
                  ) : null}
                  <Codes codes={e.reasonCodes} />
                </li>
              ))}
            </ul>
          </Panel>
        </TabsContent>
      </Tabs>

      <Dialog
        open={pending !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !busy) {
            setPending(null);
            setPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>
              {pending?.description} Re-enter your password to confirm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {formError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}
            {pending?.extra === "label" ? (
              <div className="space-y-1.5">
                <Label htmlFor="sc-label">Device name</Label>
                <Input
                  id="sc-label"
                  value={label}
                  maxLength={40}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            ) : null}
            {pending?.extra === "level" ? (
              <div className="space-y-1.5">
                <Label htmlFor="sc-level">Level</Label>
                <select
                  id="sc-level"
                  className="app-select flex h-10 w-full rounded-md border border-input bg-surface-elevated px-3 text-sm"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as "HIGH" | "CRITICAL")}
                >
                  <option value="HIGH">HIGH — fixed period</option>
                  <option value="CRITICAL">CRITICAL — until reviewed (bounded)</option>
                </select>
              </div>
            ) : null}
            {pending?.extra === "limits" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-devices">Device limit</Label>
                  <Input
                    id="sc-devices"
                    inputMode="numeric"
                    placeholder={`default ${detail.status.limits.defaults.deviceLimit}`}
                    value={deviceLimit}
                    onChange={(e) => setDeviceLimit(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-sessions">Session limit</Label>
                  <Input
                    id="sc-sessions"
                    inputMode="numeric"
                    placeholder={`default ${detail.status.limits.defaults.maxConcurrentSessions}`}
                    value={sessionLimit}
                    onChange={(e) => setSessionLimit(e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="sc-reason">
                Reason{pending?.reasonOptional ? " (optional)" : ""}
              </Label>
              <Input
                id="sc-reason"
                value={reason}
                maxLength={300}
                required={!pending?.reasonOptional}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-password">Your password</Label>
              <PasswordInput
                id="sc-password"
                autoComplete="current-password"
                value={password}
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !password}>
                {busy ? "Confirming…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
