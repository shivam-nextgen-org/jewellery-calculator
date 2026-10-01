import Link from "next/link";
import {
  ArrowRight,
  MonitorSmartphone,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { PendingDevicesPanel } from "@/components/admin/pending-devices-panel";
import { RestrictionsPanel } from "@/components/admin/restrictions-panel";
import { AccessRestricted } from "@/components/security/access-restricted";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { getDb } from "@/lib/mongo";
import { getPageAccess } from "@/lib/auth/session";
import { listAppUsers } from "@/lib/auth/users";
import { getSecurityConfig } from "@/lib/security/config";
import { listCustomerSecurity } from "@/lib/security/admin-security-center";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Users;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-charcoal">
            {value}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            tone === "warning"
              ? "bg-destructive/10 text-destructive"
              : "bg-champagne-muted/50 text-champagne",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboardPage() {
  const access = await getPageAccess("ADMIN");
  if (access.kind !== "ok") return <AccessRestricted />;

  const flags = getSecurityConfig().flags;
  const securityCenterEnabled = flags.adminSecurityCenter === "on";
  const showDeviceApprovals = flags.deviceVerification === "on";
  const showRestrictions = flags.restrictions === "on";

  const users = await listAppUsers();
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive).length;

  // Security roll-up is only meaningful (and only queried) when the center is on.
  let pendingDevices = 0;
  let attentionCount = 0;
  if (securityCenterEnabled) {
    const db = await getDb();
    const customers = await listCustomerSecurity(db);
    pendingDevices = customers.reduce((n, c) => n + c.pendingDevices, 0);
    attentionCount = customers.filter(
      (c) => c.restricted || c.reviewRequired,
    ).length;
  }

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Super admin"
        title="Dashboard"
        description="Workspace overview — people, access and account security at a glance."
      />

      {/* Overview stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value={totalUsers} icon={Users} />
        <StatCard
          label="Active"
          value={activeUsers}
          hint={`${totalUsers - activeUsers} disabled`}
          icon={UserCheck}
        />
        {securityCenterEnabled ? (
          <>
            <StatCard
              label="Pending devices"
              value={pendingDevices}
              hint="Awaiting approval"
              icon={MonitorSmartphone}
              tone={pendingDevices > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Needs attention"
              value={attentionCount}
              hint="Restricted or flagged"
              icon={ShieldAlert}
              tone={attentionCount > 0 ? "warning" : "default"}
            />
          </>
        ) : null}
      </div>

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-champagne" aria-hidden="true" />
                <h2 className="text-base font-semibold text-charcoal">
                  User management
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Create, edit, enable or remove workspace users and API keys.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/users">
                Open
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        {securityCenterEnabled ? (
          <Card>
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className="h-4 w-4 text-champagne"
                    aria-hidden="true"
                  />
                  <h2 className="text-base font-semibold text-charcoal">
                    Security center
                  </h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Devices, sessions, risk, restrictions and per-user limits.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/security">
                  Open
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Security action widgets (only when their flags are on) */}
      {showRestrictions ? <RestrictionsPanel /> : null}
      {showDeviceApprovals ? <PendingDevicesPanel /> : null}
    </div>
  );
}
