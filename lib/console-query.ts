/** Keep query-string pagination inside PostgREST's integer offset range. */
export function consolePage(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= 1_000_000 ? page : 1;
}

/** Reject impossible dates before constructing the WAT reporting window. */
export function consoleDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : '';
}
