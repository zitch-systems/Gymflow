import { describe, expect, it } from 'vitest';
import { normalizeNgPhone } from '@/lib/format';

// Nigerian mobile normalization used to enforce a phone at member onboarding.
describe('normalizeNgPhone', () => {
  it('accepts standard 11-digit local form', () => {
    expect(normalizeNgPhone('08031234567')).toBe('08031234567');
  });
  it('strips spaces and dashes', () => {
    expect(normalizeNgPhone('0803 123 4567')).toBe('08031234567');
    expect(normalizeNgPhone('0803-123-4567')).toBe('08031234567');
  });
  it('converts +234 / 234 country code to local 0-form', () => {
    expect(normalizeNgPhone('+2348031234567')).toBe('08031234567');
    expect(normalizeNgPhone('2348031234567')).toBe('08031234567');
  });
  it('handles the redundant zero after the country code (+234 0803…)', () => {
    expect(normalizeNgPhone('+234 0803 123 4567')).toBe('08031234567');
    expect(normalizeNgPhone('23408031234567')).toBe('08031234567');
  });
  it('adds the leading 0 to a 10-digit number', () => {
    expect(normalizeNgPhone('8031234567')).toBe('08031234567');
  });
  it('rejects invalid numbers', () => {
    expect(normalizeNgPhone('')).toBeNull();
    expect(normalizeNgPhone(null)).toBeNull();
    expect(normalizeNgPhone('0123456789')).toBeNull();   // not 7/8/9 after 0
    expect(normalizeNgPhone('0803123')).toBeNull();       // too short
    expect(normalizeNgPhone('080312345678')).toBeNull();  // too long
    expect(normalizeNgPhone('notaphone')).toBeNull();
  });
});
