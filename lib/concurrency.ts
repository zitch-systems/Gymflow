// Bounded-concurrency map. Runs `worker` over `items` with at most `limit`
// in flight at once, so a large fan-out (announcement sends, etc.) finishes
// far faster than a serial loop without opening N connections at once — and,
// crucially, completes inside the platform's after()/function runtime cap
// where a serial loop of hundreds of provider calls would be killed midway.
//
// The worker is responsible for its own error handling; a thrown error
// rejects the whole run (matching Promise.all semantics). Callers that want
// best-effort fan-out (one bad recipient shouldn't abort the rest) should
// catch inside the worker.
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const max = Math.max(1, Math.min(Math.floor(limit), items.length));
  let cursor = 0;
  const runner = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: max }, runner));
}
