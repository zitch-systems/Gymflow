import { describe, expect, it } from 'vitest';
import { dateOfBirthError } from '@/lib/profile-validation';

describe('profile birth date validation', () => {
  it.each(['', '2000-02-29', '2026-10-17'])('accepts an optional valid date %s', (value) => {
    expect(dateOfBirthError(value, '2026-10-17')).toBeNull();
  });
  it.each(['2001-02-29', '2026-02-30', 'not-a-date', '2026-10-170', '1899-12-31'])('rejects impossible or malformed date %s', (value) => {
    expect(dateOfBirthError(value, '2026-10-17')).toBeTruthy();
  });
  it('rejects dates after today', () => {
    expect(dateOfBirthError('2026-10-18', '2026-10-17')).toContain('future');
  });
});
