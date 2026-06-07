import { describe, it, expect } from 'vitest';
import { escapeIlikeEmail } from '@/lib/email-lookup';

describe('escapeIlikeEmail', () => {
  it('escapes underscores so they match literally', () => {
    // The defect this protects against: webhook backstop looks up the member
    // by Paystack customer.email via ILIKE. Without escape, the underscore in
    // ru_smith@gmail.com is an ILIKE wildcard that also matches rusmith and
    // ruXsmith — two colliding accounts make .maybeSingle() fail, and a
    // paid charge silently never produces a credit/subscription.
    expect(escapeIlikeEmail('ru_smith@gmail.com')).toBe('ru\\_smith@gmail.com');
  });

  it('escapes percent signs', () => {
    expect(escapeIlikeEmail('a%b@x.com')).toBe('a\\%b@x.com');
  });

  it('escapes backslashes before the wildcards (no double-escape)', () => {
    // ILIKE's default escape character is backslash; an unescaped backslash
    // in the input would consume the next character as escaped.
    expect(escapeIlikeEmail('a\\b@x.com')).toBe('a\\\\b@x.com');
  });

  it('leaves ordinary emails untouched', () => {
    expect(escapeIlikeEmail('alice@example.com')).toBe('alice@example.com');
  });

  it('escapes a mix of all three special chars correctly', () => {
    expect(escapeIlikeEmail('a_b%c\\d@x.com')).toBe('a\\_b\\%c\\\\d@x.com');
  });

  it('returns empty string for empty input', () => {
    expect(escapeIlikeEmail('')).toBe('');
  });
});
