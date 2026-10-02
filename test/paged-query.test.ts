import { describe, expect, it } from 'vitest';
import { chunksOf, readBoundedPages } from '@/lib/paged-query';

describe('readBoundedPages', () => {
  it('reads through a 1,000-row server page cap and detects a row beyond the export limit', async () => {
    const source = Array.from({ length: 5_001 }, (_, id) => ({ id }));
    const ranges: Array<[number, number]> = [];
    const result = await readBoundedPages(async (from, to) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    }, 5_000, 1_000);

    expect(result.rows).toHaveLength(5_000);
    expect(result.truncated).toBe(true);
    expect(result.rows.at(-1)?.id).toBe(4_999);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999], [5000, 5000]]);
  });

  it('does not call an exact multiple of the page size truncated without a sentinel query', async () => {
    const source = Array.from({ length: 5_000 }, (_, id) => ({ id }));
    const result = await readBoundedPages(async (from, to) => ({ data: source.slice(from, to + 1), error: null }), 5_000);
    expect(result.rows).toHaveLength(5_000);
    expect(result.truncated).toBe(false);
  });

  it('fails instead of returning a partial export when any page errors', async () => {
    await expect(readBoundedPages(async (from) => from === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => id), error: null }
      : { data: null, error: { message: 'database unavailable' } }, 5_000))
      .rejects.toThrow('Export query failed: database unavailable');
  });
});

describe('chunksOf', () => {
  it('keeps large IN filters below a caller-selected URL-safe size', () => {
    expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
