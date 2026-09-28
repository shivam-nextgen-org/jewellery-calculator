import { describe, expect, it } from "vitest";
import {
  parseSnapDataGoldPayload,
  pick24kObservation,
} from "@/lib/services/gold-rate-provider";

const sample = {
  unit: { quantity: "gram", currency: "INR" },
  generated_at: "2026-09-28T12:30:00Z",
  sources: [
    {
      id: "ibja",
      name: "India Bullion and Jewellers Association (IBJA)",
      retrieved_at: "2026-09-28T12:30:00Z",
    },
  ],
  observations: [
    {
      date: "2026-09-28",
      instrument: "XAU.18K",
      value: 11098.5,
      close: 11098.5,
      source: "ibja",
    },
    {
      date: "2026-09-28",
      instrument: "XAU.24K",
      instrument_id: "XAU.24K.INR.G",
      value: 14798,
      close: 14798,
      source: "ibja",
    },
  ],
};

describe("pick24kObservation", () => {
  it("prefers XAU.24K when 999 absent", () => {
    expect(pick24kObservation(sample.observations).instrument).toBe("XAU.24K");
  });

  it("prefers XAU.999 when present", () => {
    const obs = [
      ...sample.observations,
      { instrument: "XAU.999", value: 14800, close: 14800, date: "2026-09-28" },
    ];
    expect(pick24kObservation(obs).instrument).toBe("XAU.999");
  });
});

describe("parseSnapDataGoldPayload", () => {
  it("parses INR/gram 24K IBJA rate", () => {
    const quote = parseSnapDataGoldPayload(sample);
    expect(quote.rateInrPerGram).toBe(14798);
    expect(quote.currency).toBe("INR");
    expect(quote.unit).toBe("gram");
    expect(quote.source).toBe("IBJA");
    expect(quote.provider).toBe("snapdata");
    expect(quote.sourceDate).toBe("2026-09-28");
  });

  it("rejects wrong unit", () => {
    expect(() =>
      parseSnapDataGoldPayload({
        ...sample,
        unit: { quantity: "10gram", currency: "INR" },
      }),
    ).toThrow(/gram/i);
  });

  it("rejects absurd magnitudes (possible 10g misread)", () => {
    expect(() =>
      parseSnapDataGoldPayload({
        ...sample,
        observations: [
          {
            date: "2026-09-28",
            instrument: "XAU.24K",
            value: 147980,
            close: 147980,
          },
        ],
      }),
    ).toThrow(/band/i);
  });
});
