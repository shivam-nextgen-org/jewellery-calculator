/**
 * Next.js instrumentation — registers daily crons when the Node server starts.
 *
 * IMPORTANT: Do NOT import gold-rate / fx-rates / mongodb from this file.
 * Cron jobs only HTTP-call existing API routes.
 *
 * Schedules (Asia/Kolkata):
 * - Gold rate: 15 11 * * *  → 11:15 AM IST
 * - FX rates:  0 0 * * *    → 12:00 AM (midnight) IST
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const g = globalThis as typeof globalThis & {
    __atelierCronsRegistered?: boolean;
  };
  if (g.__atelierCronsRegistered) return;
  g.__atelierCronsRegistered = true;

  const { default: cron } = await import(
    /* webpackIgnore: true */ "node-cron"
  );

  const timezone =
    process.env.GOLD_RATE_TIMEZONE?.trim() ||
    process.env.FX_RATE_TIMEZONE?.trim() ||
    "Asia/Kolkata";

  function internalBaseUrl(): string {
    const port = process.env.PORT?.trim() || "3000";
    return (
      process.env.GOLD_RATE_INTERNAL_URL?.replace(/\/$/, "").trim() ||
      process.env.FX_INTERNAL_URL?.replace(/\/$/, "").trim() ||
      `http://127.0.0.1:${port}`
    );
  }

  async function postCron(path: string, label: string) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      console.error(
        `[${label}] cron skipped — set CRON_SECRET so the job can call ${path}`,
      );
      return;
    }

    const res = await fetch(`${internalBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      console.error(
        `[${label}] update failed — previous value kept:`,
        body?.error ?? `HTTP ${res.status}`,
      );
      return;
    }

    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    console.info(`[${label}] update ok`, body);
  }

  if (process.env.GOLD_RATE_CRON_DISABLED !== "1") {
    cron.schedule(
      "15 11 * * *",
      async () => {
        try {
          await postCron("/api/gold-rate/update", "gold-rate");
        } catch (err) {
          console.error(
            "[gold-rate] daily cron exception — previous rate kept:",
            err,
          );
        }
      },
      { timezone },
    );
    console.info(`[gold-rate] cron registered: 15 11 * * * (${timezone})`);
  } else {
    console.info("[gold-rate] cron disabled via GOLD_RATE_CRON_DISABLED=1");
  }

  if (process.env.FX_RATE_CRON_DISABLED !== "1") {
    cron.schedule(
      "0 0 * * *",
      async () => {
        try {
          await postCron("/api/fx-rates/update", "fx-rates");
        } catch (err) {
          console.error(
            "[fx-rates] daily cron exception — previous snapshot kept:",
            err,
          );
        }
      },
      { timezone },
    );
    console.info(`[fx-rates] cron registered: 0 0 * * * (${timezone})`);
  } else {
    console.info("[fx-rates] cron disabled via FX_RATE_CRON_DISABLED=1");
  }
}
