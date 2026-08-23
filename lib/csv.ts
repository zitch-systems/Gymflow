// CSV serialisation for the admin console's data exports.
//
// Pure (no server-only import) so the vitest suite exercises it directly. Was
// duplicated verbatim in the members and wallet export routes and covered by no
// test at all — which is a poor place for a security control to live, because
// the escaping here is the only thing standing between a member-supplied name
// and a formula executing in whoever opens the sheet.
//
// Two separate concerns, easy to conflate:
//   1. CSV QUOTING — a cell containing a comma, quote or newline must be quoted
//      and its quotes doubled (RFC 4180), or the row silently gains columns.
//   2. FORMULA INJECTION — Excel/Sheets/LibreOffice execute a cell beginning
//      with = + - @ (or a leading tab/CR) as a formula, so a member named
//      `=HYPERLINK("http://evil","click")` becomes a live link in the owner's
//      accounting export. Prefixing a tab makes it inert text while still
//      reading correctly in the sheet.

/** Escape one value for a CSV cell: neutralise formulas, then quote if needed. */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Prefix formula-injection characters so spreadsheet apps don't execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `\t${s}` : s;
  // \r as well as \n: a lone CR (no LF) inside a value — "Ada\rBo" from a
  // pasted-in name — went out unquoted, and Excel and several CSV parsers
  // treat a bare CR as a row break, so the export silently gained a row and
  // every column after it shifted.
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Serialise a header + rows into an RFC 4180-ish CSV document. */
export function toCsv(header: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/**
 * Build a safe download filename: `<prefix>-<gym-slug>-<YYYY-MM-DD>.csv`.
 *
 * The gym name is staff-supplied and lands in a Content-Disposition header, so
 * it is reduced to a slug — a quote or newline there would break the header (or
 * let a caller inject one).
 */
export function csvFilename(prefix: string, gymName: string | null | undefined, onDate: Date = new Date()): string {
  const slug = (gymName ?? 'gym')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'gym';
  return `${prefix}-${slug}-${onDate.toISOString().slice(0, 10)}.csv`;
}
