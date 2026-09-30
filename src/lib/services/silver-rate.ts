import { patchSilverRateOnAllDefaults } from "@/lib/services/settings";
import {
  getSilverRateProvider,
  type IndianSilverQuote,
} from "@/lib/services/silver-rate-provider";

export type SilverRateUpdateResult =
  | {
      ok: true;
      silverRate: number;
      silverRateLastUpdatedAt: string;
      updatedCount: number;
      meta: {
        source: string;
        provider: string;
        purity: string;
        unit: string;
        sourceDate: string;
        retrievedAt: string | null;
      };
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Shared entry point for cron + manual button.
 * Fetches Indian domestic 999 silver INR/gram benchmark.
 * On any failure: does NOT write to MongoDB (previous rate kept).
 */
export async function updateSilverRate(): Promise<SilverRateUpdateResult> {
  try {
    const provider = getSilverRateProvider();
    const quote: IndianSilverQuote = await provider.fetchIndianSilverRate();
    const silverRate = quote.rateInrPerGram;
    const silverRateLastUpdatedAt = new Date().toISOString();

    const { updatedCount } = await patchSilverRateOnAllDefaults(
      silverRate,
      silverRateLastUpdatedAt,
    );

    return {
      ok: true,
      silverRate,
      silverRateLastUpdatedAt,
      updatedCount,
      meta: {
        source: quote.source,
        provider: quote.provider,
        purity: quote.purity,
        unit: quote.unit,
        sourceDate: quote.sourceDate,
        retrievedAt: quote.retrievedAt,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to update silver rate";
    console.error(
      "[silver-rate] update failed — keeping previous rate:",
      message,
    );
    return { ok: false, error: message };
  }
}
