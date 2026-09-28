import { patchGold24kRateOnAllDefaults } from "@/lib/services/settings";
import {
  getGoldRateProvider,
  type IndianGoldQuote,
} from "@/lib/services/gold-rate-provider";

export type GoldRateUpdateResult =
  | {
      ok: true;
      gold24kRate: number;
      goldRateLastUpdatedAt: string;
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
 * Fetches Indian domestic 24K/999 INR/gram benchmark — NOT international XAU.
 * On any failure: does NOT write to MongoDB (previous rate kept).
 */
export async function updateGoldRate(): Promise<GoldRateUpdateResult> {
  try {
    const provider = getGoldRateProvider();
    const quote: IndianGoldQuote = await provider.fetchIndian24kRate();
    const gold24kRate = quote.rateInrPerGram;
    const goldRateLastUpdatedAt = new Date().toISOString();

    const { updatedCount } = await patchGold24kRateOnAllDefaults(
      gold24kRate,
      goldRateLastUpdatedAt,
    );

    return {
      ok: true,
      gold24kRate,
      goldRateLastUpdatedAt,
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
      err instanceof Error ? err.message : "Unable to update gold rate";
    console.error(
      "[gold-rate] update failed — keeping previous rate:",
      message,
    );
    return { ok: false, error: message };
  }
}
