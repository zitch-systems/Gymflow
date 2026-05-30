import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '@/lib/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runWithConcurrency(items, 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually parallelised, not serial
  });

  it('passes the correct index to the worker', async () => {
    const pairs: Array<[unknown, number]> = [];
    await runWithConcurrency(['a', 'b', 'c'], 3, async (item, i) => { pairs.push([item, i]); });
    expect(pairs.sort((x, y) => x[1] - y[1])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  it('no-ops on an empty list', async () => {
    let called = false;
    await runWithConcurrency([], 5, async () => { called = true; });
    expect(called).toBe(false);
  });

  it('caps workers at item count when limit exceeds length', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2], 10, async () => {
      inFlight += 1; peak = Math.max(peak, inFlight); await tick(); inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('propagates a worker rejection', async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); }),
    ).rejects.toThrow('boom');
  });
});
