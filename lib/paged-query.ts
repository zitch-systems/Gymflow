/** Small, dependency-free pagination primitive for bounded exports.
 *
 * Supabase projects return at most 1,000 rows per request by default, even if a
 * larger `.limit()` is requested. Callers provide a stable ordered query for
 * each inclusive range. We read one sentinel row beyond the product limit so
 * `truncated` describes the database result, not an API response cap.
 */

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function readBoundedPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  limit: number,
  pageSize = 1000,
): Promise<{ rows: T[]; truncated: boolean }> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Export limit must be a positive integer.');
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Page size must be a positive integer.');

  const wantedTotal = limit + 1;
  const rows: T[] = [];
  while (rows.length < wantedTotal) {
    const wanted = Math.min(pageSize, wantedTotal - rows.length);
    const from = rows.length;
    const { data, error } = await fetchPage(from, from + wanted - 1);
    if (error) throw new Error(`Export query failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < wanted) break;
  }

  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export function chunksOf<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Chunk size must be a positive integer.');
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
