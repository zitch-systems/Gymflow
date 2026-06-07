// Pure helpers for the ⌘K command palette — extracted so the substring/clamp
// behaviour is unit-testable in isolation from React.
//
// The palette component (which has to be 'use client' for the keyboard
// handlers) imports from here.

export type CommandItemSearchable = {
  label: string;
  hint?: string;
};

/**
 * Case-insensitive substring match across each item's label and optional hint.
 * Empty query returns all items unchanged. Mirrors the matcher VS Code's
 * command palette uses for its top-level filter.
 */
export function filterCommandItems<T extends CommandItemSearchable>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) =>
      i.label.toLowerCase().includes(q) || (i.hint ?? '').toLowerCase().includes(q),
  );
}

/**
 * Keep the keyboard highlight in-range as the filtered list shrinks. Returns
 * 0 for an empty list so the caller can render a stable "no matches" row.
 */
export function clampHighlight(highlight: number, listLength: number): number {
  if (listLength <= 0) return 0;
  return Math.min(Math.max(0, highlight), listLength - 1);
}
