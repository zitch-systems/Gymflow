import { describe, it, expect } from 'vitest';
import { daysUntilBirthday, isBirthdayToday, birthdayLabel } from '@/lib/birthdays';

// `now` is injected throughout so tests stay deterministic.
const NOW = (s: string) => new Date(`${s}T12:00:00`);

describe('daysUntilBirthday', () => {
  it('returns 0 on the birthday', () => {
    expect(daysUntilBirthday('1990-05-29', NOW('2026-05-29'))).toBe(0);
  });

  it('returns days remaining when the birthday is still ahead this year', () => {
    expect(daysUntilBirthday('1990-06-05', NOW('2026-05-29'))).toBe(7);
  });

  it('rolls to next year when the birthday has already passed', () => {
    // 2026-05-29 → next 2025-05-05 birthday is 2027-05-05 = 341 days out.
    const out = daysUntilBirthday('1990-05-05', NOW('2026-05-29'));
    expect(out).not.toBeNull();
    expect(out!).toBeGreaterThan(330);
    expect(out!).toBeLessThan(360);
  });

  it('returns null for missing or unparseable input', () => {
    expect(daysUntilBirthday(null)).toBeNull();
    expect(daysUntilBirthday(undefined)).toBeNull();
    expect(daysUntilBirthday('')).toBeNull();
    expect(daysUntilBirthday('not-a-date')).toBeNull();
  });

  it('returns null for impossible month/day values', () => {
    expect(daysUntilBirthday('1990-13-01')).toBeNull();
    expect(daysUntilBirthday('1990-02-32')).toBeNull();
  });

  it('ignores the year — only month/day matter (privacy + simplicity)', () => {
    // Two members born in different years but same month/day → same answer.
    expect(daysUntilBirthday('1990-06-01', NOW('2026-05-29'))).toBe(
      daysUntilBirthday('2002-06-01', NOW('2026-05-29')),
    );
  });

  it('handles leap-day birthdays without throwing', () => {
    // Feb 29: in a non-leap year, JS rolls Feb 29 → Mar 1, which is a defensible
    // calendar fallback. Just make sure we return something non-null.
    expect(daysUntilBirthday('1996-02-29', NOW('2027-01-15'))).not.toBeNull();
  });
});

describe('isBirthdayToday', () => {
  it('true on the day, false otherwise', () => {
    expect(isBirthdayToday('1990-05-29', NOW('2026-05-29'))).toBe(true);
    expect(isBirthdayToday('1990-05-29', NOW('2026-05-28'))).toBe(false);
    expect(isBirthdayToday(null, NOW('2026-05-29'))).toBe(false);
  });
});

describe('birthdayLabel', () => {
  it('handles today / tomorrow / future cases', () => {
    expect(birthdayLabel(0)).toBe('Today 🎂');
    expect(birthdayLabel(1)).toBe('Tomorrow');
    expect(birthdayLabel(7)).toBe('In 7 days');
  });
});
