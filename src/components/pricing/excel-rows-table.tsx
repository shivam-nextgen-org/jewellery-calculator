"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { JewelleryExtractedData } from "@/types/jewellery";
import type { ExcelRowValidation } from "@/lib/excel";

export type ExcelTableRow = {
  sheetRow: number;
  data: JewelleryExtractedData;
  validation: ExcelRowValidation;
};

const PAGE_SIZE = 50;

function rowMatchesSearch(row: ExcelTableRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.data.designNo,
    row.data.category,
    row.data.goldCode,
    row.data.goldMetal,
    row.data.goldPurity,
    row.data.goldColor,
    row.data.diamondType,
    row.data.diamondShape,
    String(row.sheetRow),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function ExcelRowsTable({
  rows,
  selectedIndex,
  onSelect,
  fileName,
}: {
  rows: ExcelTableRow[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  fileName?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [rowFrom, setRowFrom] = useState("");
  const [rowTo, setRowTo] = useState("");
  const [page, setPage] = useState(0);

  const query = search.trim().toLowerCase();
  const fromNum = rowFrom.trim() === "" ? null : Number(rowFrom);
  const toNum = rowTo.trim() === "" ? null : Number(rowTo);

  const filtered = useMemo(() => {
    const fromOk =
      fromNum == null || (Number.isFinite(fromNum) && fromNum > 0);
    const toOk = toNum == null || (Number.isFinite(toNum) && toNum > 0);

    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (!rowMatchesSearch(row, query)) return false;
        if (fromOk && fromNum != null && row.sheetRow < fromNum) return false;
        if (toOk && toNum != null && row.sheetRow > toNum) return false;
        return true;
      });
  }, [rows, query, fromNum, toNum]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageSlice = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const hasFilters = Boolean(query || rowFrom.trim() || rowTo.trim());

  function clearFilters() {
    setSearch("");
    setRowFrom("");
    setRowTo("");
    setPage(0);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            Excel rows
          </p>
          <p className="mt-0.5 text-sm text-charcoal">
            {fileName ? (
              <span className="font-medium">{fileName}</span>
            ) : (
              "Uploaded sheet"
            )}
            <span className="text-muted-foreground">
              {" "}
              · {rows.length} row{rows.length === 1 ? "" : "s"}
              {hasFilters
                ? ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}`
                : ""}
            </span>
          </p>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search design, category, gold code…"
            className="h-9 pl-8 pr-8"
            aria-label="Search Excel rows"
          />
          {search ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-charcoal"
              onClick={() => {
                setSearch("");
                setPage(0);
              }}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="w-full text-xs text-muted-foreground sm:w-auto">
            Sheet row
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={rowFrom}
              onChange={(e) => {
                setRowFrom(e.target.value);
                setPage(0);
              }}
              placeholder="From"
              className="h-8 w-full min-w-0 sm:w-20"
              aria-label="Filter from sheet row"
            />
            <span className="shrink-0 text-xs text-muted-foreground">–</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={rowTo}
              onChange={(e) => {
                setRowTo(e.target.value);
                setPage(0);
              }}
              placeholder="To"
              className="h-8 w-full min-w-0 sm:w-20"
              aria-label="Filter to sheet row"
            />
          </div>
          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 max-h-[min(52vh,420px)] flex-1 overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface-elevated/95 backdrop-blur">
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Design No</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Gold Code</th>
              <th className="px-3 py-2 font-medium text-right">Gross</th>
              <th className="px-3 py-2 font-medium text-right">Net</th>
              <th className="px-3 py-2 font-medium text-right">Dia Wt</th>
              <th className="sticky right-0 z-20 border-l border-border bg-surface-elevated px-2 py-2 text-center font-medium">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {rows.length === 0
                    ? "No rows loaded."
                    : "No rows match your search / row filter."}
                </td>
              </tr>
            ) : (
              pageSlice.map(({ row, index }) => {
                const selected = selectedIndex === index;
                const invalid = !row.validation.valid;
                return (
                  <tr
                    key={`${row.sheetRow}-${row.data.designNo}-${index}`}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      selected && "bg-champagne-muted/40",
                      invalid && "opacity-70",
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.sheetRow}
                    </td>
                    <td className="px-3 py-2 font-medium text-charcoal">
                      <span className="inline-flex items-center gap-1.5">
                        {row.data.designNo || "—"}
                        {invalid && (
                          <span title={row.validation.errors.join("; ")}>
                            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-charcoal-muted">
                      {row.data.category || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.data.goldCode || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.data.grossWeight || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.data.netWeight || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.data.diamondWeight || "—"}
                    </td>
                    <td
                      className={cn(
                        "sticky right-0 z-10 border-l border-border/60 px-2 py-1.5 text-center",
                        selected ? "bg-[#efe3cf]" : "bg-surface",
                      )}
                    >
                      <Button
                        type="button"
                        size="icon"
                        variant={selected ? "champagne" : "outline"}
                        className="h-8 w-8"
                        disabled={invalid}
                        aria-label={
                          invalid
                            ? `Row ${row.sheetRow} has errors`
                            : `Use row ${row.sheetRow}`
                        }
                        title={
                          invalid
                            ? row.validation.errors.join("; ")
                            : "Load this row into the form"
                        }
                        onClick={() => onSelect(index)}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <span className="px-1 tabular-nums">
              {safePage + 1}/{pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Click the arrow to load a row into the form. Switch rows anytime —
          edits are kept per row.
        </p>
      )}
    </div>
  );
}
