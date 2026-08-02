// Query handling for the admin console's global search.
//
// Pure (no I/O, no server-only import) so the vitest suite exercises it
// directly — the same split used by lib/facility.ts and lib/email/from.ts.
//
// The security-relevant part is sanitizeSearchTerm. Every search term is
// interpolated into a PostgREST `.or()` filter string, which has its own
// grammar: conditions are comma-separated, parentheses group them, and `%`/`*`
// are LIKE wildcards. An unsanitised term containing those characters does not
// error — it silently becomes EXTRA filter conditions, which is how a search box
// turns into a way to widen a query beyond its intended columns. So the
// grammar's metacharacters are stripped rather than escaped: none of them
// carries meaning a person typing a member's name or email actually wants.
// `.`, `@`, `-`, `_` and apostrophes are deliberately KEPT — they are ordinary
// characters in real emails and names (o'brien@example.com).

/** Below this, a search matches so much of the roster it isn't worth running. */
export const MIN_QUERY_LENGTH = 2;
/** Anything longer is a paste accident; bound the filter we build from it. */
export const MAX_QUERY_LENGTH = 64;

// PostgREST or()-grammar metacharacters + LIKE wildcards.
const UNSAFE = /[%,()*\\"]/g;
// C0 control characters — including the CR/LF that would split a header.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Reduce raw user input to something safe to interpolate into a PostgREST
 *  filter. Always returns a trimmed, length-capped string (possibly empty). */
export function sanitizeSearchTerm(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(CONTROL, ' ')
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/** Is this term worth issuing a query for? */
export function isSearchable(term: string): boolean {
  return term.length >= MIN_QUERY_LENGTH;
}

/**
 * Build a PostgREST `.or()` filter matching `term` against any of `fields`.
 * The term must already be sanitised; passing an unsanitised one is a bug, so
 * this sanitises again rather than trusting the caller.
 */
export function ilikeOrFilter(fields: readonly string[], term: string): string {
  const safe = sanitizeSearchTerm(term);
  return fields.map((f) => `${f}.ilike.%${safe}%`).join(',');
}

/** Rough intent detection, used to order the result groups sensibly: someone
 *  who typed an email is looking for a person, not a class. */
export function looksLikeEmail(term: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(term.trim());
}

/**
 * Order matches by how well they match: exact first, then prefix, then the
 * rest. Ties keep their incoming order (Array.prototype.sort is stable), so a
 * caller's own ordering — most recently joined, say — survives within a tier.
 */
export function rankMatches<T>(items: readonly T[], term: string, label: (item: T) => string): T[] {
  const needle = term.trim().toLowerCase();
  const tier = (item: T): number => {
    const value = (label(item) ?? '').toLowerCase();
    if (value === needle) return 0;
    if (value.startsWith(needle)) return 1;
    return 2;
  };
  return [...items].sort((a, b) => tier(a) - tier(b));
}

/** One row in the results list, whatever kind of record it came from. */
export type SearchHit = {
  kind: 'member' | 'class' | 'plan';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

/** Total across every group — drives the "N results" summary and the empty state. */
export function countHits(groups: readonly { hits: readonly SearchHit[] }[]): number {
  return groups.reduce((total, g) => total + g.hits.length, 0);
}
