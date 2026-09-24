import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatINR, formatWeight } from "@/lib/format";
import { getSession } from "@/lib/auth/session";
import { listProducts } from "@/lib/services/products";
import { decimalToNumber } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
            Products
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Saved products
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Each save locks the rates used at that moment — old prices never
            silently change.
          </p>
        </div>
        <Button asChild variant="champagne">
          <Link href="/pricing" prefetch>
            <Plus />
            New Pricing
          </Link>
        </Button>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <ProductsData />
      </Suspense>
    </div>
  );
}

async function ProductsData() {
  let products: Array<{
    id: string;
    designNo: string;
    category: string;
    variationCount: number;
    priceMin: number;
    priceMax: number;
    netWeight: number;
    diamondWeight: number;
    updatedAt: string;
  }> = [];
  let error: string | null = null;

  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");
    const rows = await listProducts(session.id);
    products = rows.map((p) => ({
      id: p.id,
      designNo: p.designNo,
      category: p.category,
      variationCount: p.variationCount,
      priceMin: p.priceMin ? decimalToNumber(p.priceMin) : 0,
      priceMax: p.priceMax ? decimalToNumber(p.priceMax) : 0,
      netWeight: decimalToNumber(p.netWeight),
      diamondWeight: decimalToNumber(p.diamondWeight),
      updatedAt: p.updatedAt.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
  } catch {
    error = "Failed to load products";
  }

  return (
    <>
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {!error && products.length === 0 && (
        <Card>
          <CardHeader>
            <div className="flex h-16 w-16 items-center justify-center">
              <DiamondRingMark size={64} />
            </div>
            <CardTitle className="mt-2">No products yet</CardTitle>
            <CardDescription>
              Price a design in the Jewellery Pricing workspace, then save it
              here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/pricing" prefetch>
                Open Pricing Workspace
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {products.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Design</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium text-right">Net</th>
                    <th className="px-5 py-3 font-medium text-right">Dia</th>
                    <th className="px-5 py-3 font-medium text-right">Vars</th>
                    <th className="px-5 py-3 font-medium text-right">
                      Price range
                    </th>
                    <th className="px-5 py-3 font-medium text-right">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border/70 last:border-0 hover:bg-ivory-deep/40"
                    >
                      <td className="px-5 py-3.5 font-medium">{p.designNo}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {p.category}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatWeight(p.netWeight)}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatWeight(p.diamondWeight, "CT")}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {p.variationCount}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatINR(p.priceMin, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}{" "}
                        –{" "}
                        {formatINR(p.priceMax, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right text-muted-foreground">
                        {p.updatedAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-7 w-full animate-pulse rounded bg-ivory-deep"
          />
        ))}
      </CardContent>
    </Card>
  );
}
