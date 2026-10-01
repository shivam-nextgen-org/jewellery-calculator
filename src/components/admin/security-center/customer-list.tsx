"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/page-heading";
import { cn } from "@/lib/utils";

type Customer = {
  userId: string;
  name: string | null;
  email: string | null;
  isActive: boolean;
  riskTier: string;
  reviewRequired: boolean;
  restricted: boolean;
  restrictionLevel: string | null;
  trustedDevices: number;
  pendingDevices: number;
};

async function fetchCustomers(): Promise<
  { ok: true; customers: Customer[] } | { ok: false; error: string }
> {
  try {
    const res = await fetch("/api/admin/security/customers", {
      cache: "no-store",
    });
    const data = (await res.json()) as { customers?: Customer[]; error?: string };
    if (!res.ok) return { ok: false, error: data.error || "Could not load customers" };
    return { ok: true, customers: data.customers ?? [] };
  } catch {
    return { ok: false, error: "Could not load customers" };
  }
}

function initials(name: string | null, email: string | null) {
  const base = (name ?? email ?? "").trim();
  const parts = base.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";
}

const RISK_TONE: Record<string, string> = {
  LOW: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
  MEDIUM: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  HIGH: "border-destructive/25 bg-destructive/10 text-destructive",
  CRITICAL: "border-destructive/40 bg-destructive/15 text-destructive",
};

/** I7: customer overview with security status, searchable, consistent with Users. */
export function SecurityCustomerList() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchCustomers();
      if (cancelled) return;
      if (result.ok) setCustomers(result.customers);
      else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [customers, query]);

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email"
          className="pl-9"
          aria-label="Search customers"
        />
      </div>

      <Card>
        <CardHeader className="border-b border-border/70">
          <SectionHeading
            title="Customers"
            description="Open a customer to see devices, sessions, risk, restrictions and history."
          />
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p role="alert" className="px-4 py-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : null}
          {!loading && !error && filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {query ? "No customers match your search." : "No customers yet."}
            </p>
          ) : null}
          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-ivory-deep/40 text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">Risk</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                      Devices
                    </th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5" aria-label="Open" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((c) => (
                    <tr
                      key={c.userId}
                      className="group cursor-pointer transition-colors hover:bg-ivory-deep/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/security/${c.userId}`}
                          className="flex items-center gap-3 focus-visible:outline-none"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-champagne-muted/60 text-xs font-semibold text-charcoal">
                            {initials(c.name, c.email)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-charcoal">
                              {c.name ?? "Customer"}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={cn("border", RISK_TONE[c.riskTier] ?? RISK_TONE.LOW)}>
                          {c.riskTier}
                        </Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck
                            className="h-3.5 w-3.5 text-champagne"
                            aria-hidden="true"
                          />
                          {c.trustedDevices} trusted
                          {c.pendingDevices > 0 ? (
                            <span className="ml-1 text-amber-700">
                              · {c.pendingDevices} pending
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1">
                          {!c.isActive ? (
                            <Badge className="border-destructive/25 bg-destructive/10 text-destructive">
                              Disabled
                            </Badge>
                          ) : c.restricted ? (
                            <Badge className="border-destructive/25 bg-destructive/10 text-destructive">
                              Restricted {c.restrictionLevel}
                            </Badge>
                          ) : c.reviewRequired ? (
                            <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700">
                              Review
                            </Badge>
                          ) : (
                            <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-800">
                              Active
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/security/${c.userId}`}
                          aria-label={`Open ${c.name ?? c.email ?? "customer"}`}
                          className="inline-flex text-muted-foreground transition-colors group-hover:text-charcoal"
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
