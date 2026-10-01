import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  FileSpreadsheet,
  Gem,
  ScanLine,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccessRestricted } from "@/components/security/access-restricted";
import { getPageAccess } from "@/lib/auth/session";
import { formatINR } from "@/lib/format";
import { getPricingDefaults } from "@/lib/services/settings";
import type { GoldPurityOption, PricingDefaults } from "@/types/jewellery";

export const dynamic = "force-dynamic";

const GOLD_KARATS: GoldPurityOption[] = ["22K", "18K", "14K", "10K"];
const SILVER_GRADES: GoldPurityOption[] = ["958", "925"];

const inr = (value: number) => formatINR(value, { maximumFractionDigits: 0 });

function perGram(base: number, percent: number | undefined) {
  return percent ? Math.round((base * percent) / 100) : 0;
}

function updatedLabel(iso: string | null | undefined) {
  if (!iso) return "Set manually in Settings";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Set manually in Settings";
  return `Market rate · updated ${date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const access = await getPageAccess("USER");
  if (access.kind === "denied") return <AccessRestricted device={access.device} />;
  const name = access.kind === "ok" ? access.user.name.split(" ")[0] : null;
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-charcoal px-6 py-8 text-ivory sm:px-10 sm:py-10">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-champagne/25 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-champagne-soft/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-champagne-soft">{today}</p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
              {greeting()}
              {name ? `, ${name}` : ""}.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ivory/70">
              Today&apos;s pricing rates at a glance. Every calculation in the
              workspace uses these numbers.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="champagne" size="lg">
              <Link href="/pricing" prefetch>
                <Calculator />
                New pricing
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-ivory/25 bg-transparent text-ivory hover:bg-ivory/10 hover:text-ivory"
            >
              <Link href="/settings" prefetch>
                <Settings2 />
                Update rates
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Suspense fallback={<RateBoardSkeleton />}>
        <RateBoard userId={access.kind === "ok" ? access.user.id : null} />
      </Suspense>

      <Workflow />
    </div>
  );
}

async function RateBoard({ userId }: { userId: string | null }) {
  let defaults: PricingDefaults | null = null;
  try {
    if (userId) defaults = await getPricingDefaults(userId);
  } catch {
    defaults = null;
  }
  if (!defaults) {
    return (
      <p role="alert" className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted-foreground">
        Rates couldn&apos;t be loaded right now. Refresh the page, or check Settings.
      </p>
    );
  }

  const pct = defaults.purityPercentages;
  const gold = defaults.gold24kRate;
  const silver = defaults.silverRate;
  const natural = defaults.defaultDiamondRateNatural || defaults.defaultDiamondRate;
  const diamonds = [
    { label: "Natural diamond", rate: natural, hint: "Mined" },
    { label: "Lab-grown diamond", rate: defaults.defaultDiamondRateLabGrown, hint: "CVD / HPHT" },
    { label: "Moissanite", rate: defaults.defaultDiamondRateMoissanite, hint: "Simulant" },
  ];

  return (
    <section aria-labelledby="rates-heading" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="rates-heading" className="text-lg font-semibold tracking-tight text-charcoal">
            Current rates
          </h2>
          <p className="text-sm text-muted-foreground">Per gram for metals, per carat for stones.</p>
        </div>
        <Link
          href="/settings"
          prefetch
          className="hidden items-center gap-1 text-sm font-medium text-champagne hover:text-charcoal sm:inline-flex"
        >
          Edit rates <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Gold */}
        <RateCard
          tone="gold"
          eyebrow="Gold · 24K"
          value={inr(gold)}
          unit="per gram"
          footnote={updatedLabel(defaults.goldRateLastUpdatedAt)}
        >
          {GOLD_KARATS.map((karat) => (
            <RateRow key={karat} label={karat} sub={pct[karat] ? `${pct[karat]}%` : undefined} value={inr(perGram(gold, pct[karat]))} />
          ))}
        </RateCard>

        {/* Silver */}
        <RateCard
          tone="silver"
          eyebrow="Silver · 999"
          value={inr(silver)}
          unit="per gram"
          footnote={updatedLabel(defaults.silverRateLastUpdatedAt)}
        >
          {SILVER_GRADES.map((grade) => (
            <RateRow
              key={grade}
              label={grade === "925" ? "925 Sterling" : grade}
              sub={pct[grade] ? `${pct[grade]}%` : undefined}
              value={inr(perGram(silver, pct[grade]))}
            />
          ))}
        </RateCard>

        {/* Diamonds */}
        <article className="flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_1px_2px_rgba(26,24,22,0.04)]">
          <div className="h-1 bg-gradient-to-r from-sky-200 via-indigo-200 to-violet-200" aria-hidden="true" />
          <div className="flex items-center gap-2 px-6 pt-5 text-sm font-medium text-charcoal-muted">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
              <Gem className="h-4 w-4" aria-hidden="true" />
            </span>
            Diamonds &amp; stones
          </div>
          <ul className="flex-1 space-y-1 px-3 py-3">
            {diamonds.map((d) => (
              <li key={d.label} className="flex items-center justify-between rounded-lg px-3 py-3 hover:bg-ivory-deep/50">
                <span>
                  <span className="block text-sm font-medium text-charcoal">{d.label}</span>
                  <span className="block text-xs text-muted-foreground">{d.hint}</span>
                </span>
                <span className="text-right">
                  <span className="block font-display text-xl font-medium tabular-nums text-charcoal">
                    {d.rate ? inr(d.rate) : "—"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">per carat</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border/70 px-6 py-3 text-xs text-muted-foreground">
            Default diamond discount: {defaults.defaultDiamondDiscount}%
          </p>
        </article>
      </div>
    </section>
  );
}

function RateCard({
  tone,
  eyebrow,
  value,
  unit,
  footnote,
  children,
}: {
  tone: "gold" | "silver";
  eyebrow: string;
  value: string;
  unit: string;
  footnote: string;
  children: React.ReactNode;
}) {
  const gold = tone === "gold";
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_1px_2px_rgba(26,24,22,0.04)]">
      <div
        className={gold ? "h-1 bg-gradient-to-r from-champagne-soft via-champagne to-amber-300" : "h-1 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200"}
        aria-hidden="true"
      />
      <div className="px-6 pt-5">
        <div className="flex items-center gap-2 text-sm font-medium text-charcoal-muted">
          <span
            className={
              gold
                ? "h-3 w-3 rounded-full bg-gradient-to-br from-amber-200 to-champagne ring-2 ring-champagne-muted"
                : "h-3 w-3 rounded-full bg-gradient-to-br from-slate-100 to-slate-400 ring-2 ring-slate-200"
            }
            aria-hidden="true"
          />
          {eyebrow}
        </div>
        <p className="mt-3 font-display text-4xl font-medium tabular-nums tracking-tight text-charcoal">{value}</p>
        <p className="text-xs text-muted-foreground">{unit}</p>
      </div>
      <ul className="mt-4 flex-1 divide-y divide-border/60 border-t border-border/60 px-6">{children}</ul>
      <p className="flex items-center gap-1.5 border-t border-border/70 px-6 py-3 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-champagne" aria-hidden="true" />
        {footnote}
      </p>
    </article>
  );
}

function RateRow({ label, sub, value }: { label: string; sub?: string; value: string }) {
  return (
    <li className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-charcoal">
        {label}
        {sub ? <span className="ml-2 text-xs text-muted-foreground">{sub}</span> : null}
      </span>
      <span className="font-medium tabular-nums text-charcoal">{value}</span>
    </li>
  );
}

const STEPS = [
  { icon: ScanLine, title: "Import", text: "Scan a design sheet or upload your Excel file." },
  { icon: Calculator, title: "Price", text: "Pick metals, purities, colours and stones. Every variation is priced." },
  { icon: FileSpreadsheet, title: "Export", text: "Download the full price table as Excel, in any currency." },
];

function Workflow() {
  return (
    <section aria-labelledby="workflow-heading" className="rounded-2xl border border-border/80 bg-surface-elevated px-6 py-6 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="workflow-heading" className="text-lg font-semibold tracking-tight text-charcoal">
          From design sheet to price list
        </h2>
        <Link href="/pricing" prefetch className="inline-flex items-center gap-1 text-sm font-medium text-champagne hover:text-charcoal">
          Open workspace <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <ol className="mt-5 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="flex gap-4 rounded-xl border border-border/70 bg-surface p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-champagne-muted/60 text-charcoal">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-xs font-medium uppercase tracking-[0.14em] text-champagne">Step {i + 1}</span>
                <span className="block text-sm font-semibold text-charcoal">{step.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{step.text}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RateBoardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-72 animate-pulse rounded-2xl border border-border/70 bg-surface" />
      ))}
    </div>
  );
}
