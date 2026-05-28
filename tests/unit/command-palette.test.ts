import { describe, it, expect } from 'vitest';
import { filterCommandItems, clampHighlight } from '@/lib/command-palette';

const items = [
  { label: 'Members', hint: 'Main' },
  { label: 'Analytics', hint: 'Main' },
  { label: 'Pricing', hint: 'Admin' },
  { label: 'Audit log', hint: 'Admin' },
  { label: 'Business hours', hint: 'Admin' },
];

describe('command-palette — filterCommandItems', () => {
  it('returns every item for an empty query', () => {
    expect(filterCommandItems(items, '')).toEqual(items);
    expect(filterCommandItems(items, '   ')).toEqual(items);
  });

  it('does case-insensitive substring matching on label', () => {
    expect(filterCommandItems(items, 'analy').map((i) => i.label)).toEqual(['Analytics']);
    expect(filterCommandItems(items, 'ANALY').map((i) => i.label)).toEqual(['Analytics']);
  });

  it('also matches on the optional hint so "Admin" surfaces every admin item', () => {
    expect(filterCommandItems(items, 'admin').map((i) => i.label))
      .toEqual(['Pricing', 'Audit log', 'Business hours']);
  });

  it('returns empty when nothing matches — does not crash, does not fall back to all', () => {
    expect(filterCommandItems(items, 'xxxxx')).toEqual([]);
  });

  it('trims the query so trailing spaces from autocomplete don\'t hide every result', () => {
    expect(filterCommandItems(items, '  members  ').map((i) => i.label)).toEqual(['Members']);
  });
});

describe('command-palette — clampHighlight', () => {
  it('returns 0 when the list is empty (so the caller can render a stable "no matches" row)', () => {
    expect(clampHighlight(5, 0)).toBe(0);
    expect(clampHighlight(0, 0)).toBe(0);
    expect(clampHighlight(-3, 0)).toBe(0);
  });

  it('clamps to listLength-1 when the requested highlight overshoots', () => {
    expect(clampHighlight(99, 5)).toBe(4);
    expect(clampHighlight(5, 5)).toBe(4);
  });

  it('clamps negative values to 0', () => {
    expect(clampHighlight(-1, 5)).toBe(0);
    expect(clampHighlight(-100, 5)).toBe(0);
  });

  it('passes through in-range values unchanged', () => {
    expect(clampHighlight(0, 5)).toBe(0);
    expect(clampHighlight(3, 5)).toBe(3);
  });
});
