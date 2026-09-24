import { Suspense } from "react";
import { DiamondRingMark } from "@/components/brand/diamond-ring";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatINR } from "@/lib/format";
import { getSession } from "@/lib/auth/session";
import { listCalculations } from "@/lib/services/products";
import { decimalToNumber } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
          History
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Calculation history
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every save stores a rate snapshot — gold, diamond, making — so
          historical prices stay frozen.
        </p>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <HistoryData />
      </Suspense>
    </div>
  );
}

async function HistoryData() {
  let rows: Array<{
    id: string;
    designNo: string;
    category: string;
    gold24kRate: number;
    diamondRate: number;
    diamondDiscountPercent: number;
    makingCharge: number;
    variationCount: number;
    priceMin: number;
    priceMax: number;
    createdAt: string;
  }> = [];
  let error: string | null = null;

  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");
    const data = await listCalculations(session.id);
    rows = data.map((row) => ({
      id: row.id,
      designNo: row.product.designNo,
      category: row.product.category,
      gold24kRate: decimalToNumber(row.gold24kRate),
      diamondRate: decimalToNumber(row.diamondRate),
      diamondDiscountPercent: decimalToNumber(row.diamondDiscountPercent),
      makingCharge: decimalToNumber(row.makingCharge),
      variationCount: row.variationCount,
      priceMin: decimalToNumber(row.priceMin),
      priceMax: decimalToNumber(row.priceMax),
      createdAt: row.createdAt.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
  } catch {
    error = "Failed to load history";
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

      {!error && rows.length === 0 && (
        <Card>
          <CardHeader>
            <div className="flex h-16 w-16 items-center justify-center">
              <DiamondRingMark size={64} />
            </div>
            <CardTitle className="mt-2">No history yet</CardTitle>
            <CardDescription>
              Save a priced design to create the first calculation snapshot.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-5 py-3 font-medium">When</th>
                    <th className="px-5 py-3 font-medium">Design</th>
                    <th className="px-5 py-3 font-medium text-right">
                      24K Rate
                    </th>
                    <th className="px-5 py-3 font-medium text-right">
                      Dia Rate
                    </th>
                    <th className="px-5 py-3 font-medium text-right">Disc%</th>
                    <th className="px-5 py-3 font-medium text-right">Making</th>
                    <th className="px-5 py-3 font-medium text-right">Vars</th>
                    <th className="px-5 py-3 font-medium text-right">Range</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/70 last:border-0 hover:bg-ivory-deep/40"
                    >
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {row.createdAt}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium">{row.designNo}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.category}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatINR(row.gold24kRate, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatINR(row.diamondRate, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {row.diamondDiscountPercent}%
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatINR(row.makingCharge, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {row.variationCount}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">
                        {formatINR(row.priceMin, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}{" "}
                        –{" "}
                        {formatINR(row.priceMax, {
                          maximumFractionDigits: 0,
                          minimumFractionDigits: 0,
                        })}
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
