import { watDateISO } from '@/lib/format';

export function dateOfBirthError(value: string, today = watDateISO()): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter a valid date of birth.';
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01') {
    return 'Enter a valid date of birth.';
  }
  return value > today ? 'Date of birth cannot be in the future.' : null;
}
