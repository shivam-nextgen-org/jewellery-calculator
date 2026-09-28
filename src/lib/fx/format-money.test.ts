import { describe, expect, it } from "vitest";
import { convertFromInr, formatMoney } from "@/lib/fx/format-money";

describe("convertFromInr", () => {
  it("keeps INR unchanged", () => {
    expect(convertFromInr(61009.25, "INR", { USD: 0.0119 })).toBe(61009.25);
  });

  it("multiplies by stored INR→target rate", () => {
    expect(convertFromInr(100, "USD", { USD: 0.012 })).toBe(1.2);
  });

  it("returns null when rate missing", () => {
    expect(convertFromInr(100, "USD", { INR: 1 })).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats INR exactly like formatINR", () => {
    expect(formatMoney(61009.25, "INR", {})).toBe("₹61,009.25");
  });

  it("formats USD with symbol when rate exists", () => {
    expect(formatMoney(100, "USD", { USD: 0.012 })).toBe("$1.20");
  });

  it("keeps INR formatting when FX rate missing", () => {
    expect(formatMoney(100, "USD", { INR: 1 })).toBe("₹100.00");
  });
});
