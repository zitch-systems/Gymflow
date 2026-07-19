import Link from 'next/link';
import type { Route } from 'next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Server-rendered offset pager for list pages. Builds prev/next links that
// preserve the current query string (filters, search) and only swap `page`.
// Renders nothing when everything fits on one page.
//
// `basePath` is the route without query; `params` is the current query minus
// `page` (already-decoded key/value pairs to carry across).
export function Pagination({
  basePath, params, page, pageSize, total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);

  const href = (p: number): Route => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
    if (p > 1) usp.set('page', String(p));
    const qs = usp.toString();
    return (qs ? `${basePath}?${qs}` : basePath) as Route;
  };

  if (total <= pageSize) {
    return (
      <div className="pager">
        <span className="pager-count">{total} {total === 1 ? 'result' : 'results'}</span>
      </div>
    );
  }

  return (
    <div className="pager">
      <span className="pager-count">Showing {from}–{to} of {total}</span>
      <div className="pager-nav">
        {cur > 1
          ? <Link href={href(cur - 1)} className="gf-btn gf-btn-secondary gf-btn-sm" rel="prev"><ChevronLeft size={15} strokeWidth={2} /> Prev</Link>
          : <span className="gf-btn gf-btn-secondary gf-btn-sm" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: 'none' }}><ChevronLeft size={15} strokeWidth={2} /> Prev</span>}
        <span className="pager-page">Page {cur} of {pages}</span>
        {cur < pages
          ? <Link href={href(cur + 1)} className="gf-btn gf-btn-secondary gf-btn-sm" rel="next">Next <ChevronRight size={15} strokeWidth={2} /></Link>
          : <span className="gf-btn gf-btn-secondary gf-btn-sm" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: 'none' }}>Next <ChevronRight size={15} strokeWidth={2} /></span>}
      </div>
    </div>
  );
}
