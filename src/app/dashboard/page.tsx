import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/format";
import { getDashboardStats, listProducts } from "@/lib/services/products";
import { decimalToNumber } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

function formatUpdated(iso: Date) {
  return iso.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
            Dashboard
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
            Atelier overview
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Image to final prices in one workspace. Live from database.
          </p>
        </div>
        <Button asChild variant="champagne" size="lg">
          <Link href="/pricing" prefetch>
            <Plus />
            New Jewellery Pricing
          </Link>
        </Button>
      </div>

      <Suspense fallback={<DashboardDataSkeleton />}>
        <DashboardData />
      </Suspense>
    </div>
  );
}

/** Async data section — streamed so the page frame shows instantly. */
async function DashboardData() {
  let stats = {
    totalDesigns: 0,
    todaysImports: 0,
    calculatedProducts: 0,
    totalVariations: 0,
    current24kGoldRate: 0,
  };
  let recent: Array<{
    id: string;
    designNo: string;
    category: string;
    variationCount: number;
    priceMin: number;
    priceMax: number;
    updatedAt: string;
  }> = [];

  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");
    const [dashboardStats, recentProducts] = await Promise.all([
      getDashboardStats(session.id),
      listProducts(session.id, 5),
    ]);
    stats = dashboardStats;
    recent = recentProducts.map((p) => ({
      id: p.id,
      designNo: p.designNo,
      category: p.category,
      variationCount: p.variationCount,
      priceMin: p.priceMin ? decimalToNumber(p.priceMin) : 0,
      priceMax: p.priceMax ? decimalToNumber(p.priceMax) : 0,
      updatedAt: formatUpdated(p.updatedAt),
    }));
  } catch {
    // empty state if DB unavailable
  }

  const tiles = [
    { label: "Total Designs", value: String(stats.totalDesigns) },
    { label: "Today's Imports", value: String(stats.todaysImports) },
    {
      label: "Calculated Products",
      value: String(stats.calculatedProducts),
    },
    { label: "Total Variations", value: String(stats.totalVariations) },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.label}
            className="transition-transform duration-200 hover:-translate-y-0.5"
          >
            <CardHeader className="pb-2">
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight">
                {tile.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2 text-champagne">
              <Sparkles className="h-4 w-4" />
              <CardDescription className="text-champagne">
                Live rate
              </CardDescription>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              Current 24K Gold
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-semibold tabular-nums tracking-tight text-charcoal">
              {formatINR(stats.current24kGoldRate, {
                maximumFractionDigits: 0,
              })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">per gram</p>
            <p className="mt-4 text-xs text-muted-foreground">
              From Settings → Pricing defaults.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent designs</CardTitle>
              <CardDescription>Latest priced jewellery</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/products" prefetch>
                View all
                <ArrowUpRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">
                No saved products yet. Start a pricing session.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-y border-border text-xs uppercase tracking-[0.06em] text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Design</th>
                      <th className="px-5 py-3 font-medium">Category</th>
                      <th className="px-5 py-3 font-medium">Vars</th>
                      <th className="px-5 py-3 font-medium text-right">
                        Range
                      </th>
                      <th className="px-5 py-3 font-medium text-right">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((design) => (
                      <tr
                        key={design.id}
                        className="border-b border-border/70 last:border-0 hover:bg-ivory-deep/40"
                      >
                        <td className="px-5 py-3.5 font-medium">
                          {design.designNo}
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">
                          {design.category}
                        </td>
                        <td className="px-5 py-3.5 tabular-nums">
                          {design.variationCount}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums">
                          {formatINR(design.priceMin, {
                            maximumFractionDigits: 0,
                          })}{" "}
                          –{" "}
                          {formatINR(design.priceMax, {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td className="px-5 py-3.5 text-right text-muted-foreground">
                          {design.updatedAt}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Lightweight skeleton shown instantly while the data streams in. */
function DashboardDataSkeleton() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-ivory-deep" />
              <div className="mt-2 h-8 w-16 animate-pulse rounded bg-ivory-deep" />
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="h-4 w-20 animate-pulse rounded bg-ivory-deep" />
            <div className="mt-2 h-8 w-40 animate-pulse rounded bg-ivory-deep" />
          </CardHeader>
          <CardContent>
            <div className="h-10 w-32 animate-pulse rounded bg-ivory-deep" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="h-5 w-32 animate-pulse rounded bg-ivory-deep" />
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-6 w-full animate-pulse rounded bg-ivory-deep"
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
