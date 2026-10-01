import { after } from "next/server";

/**
 * Runs security bookkeeping after the response is sent (Next.js `after`),
 * so it never adds latency to, or breaks, the request that triggered it.
 * Outside a request scope (scripts, tests) it runs as a detached promise
 * that `drainBackgroundTasks()` can await.
 */
const pending = new Set<Promise<void>>();

export function runAfterResponse(task: () => Promise<void>): void {
  const safe = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[security] background task failed (${error instanceof Error ? error.name : "unknown"})`);
    }
  };
  try {
    after(safe);
  } catch {
    const promise = safe().finally(() => pending.delete(promise));
    pending.add(promise);
  }
}

/** Test/script helper: wait for detached tasks started outside a request. */
export async function drainBackgroundTasks(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
