import { describe, expect, it } from 'vitest';
import { consoleDate, consolePage } from '@/lib/console-query';

describe('console pagination', () => {
  it('accepts positive integer pages', () => {
    expect(consolePage('2')).toBe(2);
    expect(consolePage('1000000')).toBe(1000000);
  });
  it.each([undefined, '', '0', '-1', '1.5', 'Infinity', 'NaN', '1e6', '0x10', '1000001', '999999999999999999999999'])('uses page one for invalid offset %s', (value) => {
    expect(consolePage(value)).toBe(1);
  });
});


describe('console reporting dates', () => {
  it('accepts real calendar dates including leap days', () => {
    expect(consoleDate('2024-02-29')).toBe('2024-02-29');
    expect(consoleDate('2026-10-17')).toBe('2026-10-17');
  });
  it.each(['2026-02-29', '2026-13-01', '2026-10-32', 'bad', '', null])('rejects invalid calendar date %s', (value) => {
    expect(consoleDate(value)).toBe('');
  });
});
