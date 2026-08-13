import { describe, expect, it } from 'vitest';
import { canonicalWaId, dialLink, formatWaId, localToWaId, waIdToLocal } from '@/lib/whatsapp/phone';

// The WhatsApp boundary stores E.164-without-plus ("2348031234567"); the rest
// of GymFlow stores the local form ("08031234567"). A mistake here does not
// throw — it silently fails to find the member and tells them their number
// isn't registered when it plainly is. Hence the coverage.
describe('waIdToLocal', () => {
  it('converts a wa_id to the local form the profiles table holds', () => {
    expect(waIdToLocal('2348031234567')).toBe('08031234567');
  });
  it('tolerates a leading plus and punctuation Meta should not send but might', () => {
    expect(waIdToLocal('+234 803 123 4567')).toBe('08031234567');
  });
  it('accepts a number already in local form', () => {
    expect(waIdToLocal('08031234567')).toBe('08031234567');
  });
  it('rejects anything that is not a Nigerian mobile', () => {
    expect(waIdToLocal('')).toBeNull();
    expect(waIdToLocal('12025550123')).toBeNull();
    expect(waIdToLocal('234123')).toBeNull();
  });
});

describe('localToWaId', () => {
  it('converts the local form to a wa_id', () => {
    expect(localToWaId('08031234567')).toBe('2348031234567');
  });
  it('accepts the international spellings already in the database', () => {
    expect(localToWaId('+2348031234567')).toBe('2348031234567');
    expect(localToWaId('2348031234567')).toBe('2348031234567');
    expect(localToWaId('8031234567')).toBe('2348031234567');
  });
  it('returns null for a non-mobile', () => {
    expect(localToWaId('abc')).toBeNull();
  });
});

describe('canonicalWaId', () => {
  it('is idempotent — the property the unique index depends on', () => {
    const once = canonicalWaId('+234 803 123 4567');
    expect(once).toBe('2348031234567');
    expect(canonicalWaId(once!)).toBe(once);
  });
  it('maps every spelling of one number onto a single row key', () => {
    const spellings = ['08031234567', '+2348031234567', '2348031234567', '8031234567', '0803 123 4567'];
    const canonical = new Set(spellings.map((s) => canonicalWaId(s)));
    expect(canonical.size).toBe(1);
  });
});

describe('formatWaId', () => {
  it('renders a readable number for the admin table', () => {
    expect(formatWaId('2348031234567')).toBe('+234 803 123 4567');
  });
  it('passes unrecognised input straight through rather than losing it', () => {
    expect(formatWaId('12025550123')).toBe('12025550123');
  });
});

describe('dialLink', () => {
  it('normalises a Nigerian mobile to a tel-safe E.164 string', () => {
    expect(dialLink('0803 123 4567')).toBe('+2348031234567');
  });
  // Gyms legitimately publish landlines and short codes. Refusing to show one
  // because it isn't an NG mobile would be worse than showing it unformatted.
  it('keeps a non-mobile contact number, stripped of punctuation', () => {
    expect(dialLink('+1 (202) 555-0123')).toBe('+12025550123');
    expect(dialLink('01-234-5678')).toBe('012345678');
  });
  it('returns null for nothing usable', () => {
    expect(dialLink(null)).toBeNull();
    expect(dialLink('   ')).toBeNull();
    expect(dialLink('n/a')).toBeNull();
  });
});
