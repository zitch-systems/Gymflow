// Totals from public.platform_revenue_summary, aggregated in Postgres so they
// are not capped by PostgREST's max-rows the way summing fetched rows was.

export type MonthTotal = { month: string; total: number };

export type PlatformRevenueSummary = {
  memberMonthly: MonthTotal[];
  platformMonthly: MonthTotal[];
  platformThisMonth: number;
  platformAllTime: number;
  memberGmv: number;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const series = (v: unknown): MonthTotal[] =>
  Array.isArray(v)
    ? v.map((r) => ({ month: String((r as { month?: unknown }).month ?? ''), total: num((r as { total?: unknown }).total) }))
    : [];

/** Parses the RPC's jsonb. Callers throw on an RPC error first: zeros would read as real. */
export function parseRevenueSummary(data: unknown): PlatformRevenueSummary {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return {
    memberMonthly: series(d.member_monthly),
    platformMonthly: series(d.platform_monthly),
    platformThisMonth: num(d.platform_this_month),
    platformAllTime: num(d.platform_all_time),
    memberGmv: num(d.member_gmv),
  };
}

/** "2026-09" → "Sep". */
export function monthLabel(key: string): string {
  const d = new Date(`${key}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleString('en-NG', { month: 'short', timeZone: 'UTC' });
}
