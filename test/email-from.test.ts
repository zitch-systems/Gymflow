import { describe, expect, it } from 'vitest';
import { EMAIL_RE, gymFromAddress, safeDisplayName, safeLocalPart } from '@/lib/email/from';

// gyms.name is staff-written free text, and it lands UNQUOTED in a From header,
// so the display name has to be reduced to something that is both safe (no
// header injection) and a VALID unquoted RFC 5322 phrase (no address-list,
// group or route delimiters). A gym whose name breaks the From header would
// otherwise have Resend reject the send — and on the auth path that strands
// every one of its members with no confirmation / reset link.

function displayName(from: string): string {
  return from.slice(0, from.lastIndexOf(' <'));
}

describe('safeDisplayName', () => {
  it('passes an ordinary name through untouched', () => {
    expect(safeDisplayName('Iron Republic')).toBe('Iron Republic');
  });

  it('strips the specials that break an unquoted From phrase', () => {
    // Each of these would make `<name> <addr>` parse as something other than one
    // mailbox (comma/semicolon = address list, colon = group, <> = addr-spec,
    // () = comment, [] = domain-literal, @ = a second addr-spec).
    for (const ch of [',', ';', ':', '<', '>', '(', ')', '[', ']', '@']) {
      expect(safeDisplayName(`Iron${ch}Republic`)).not.toContain(ch);
    }
    expect(safeDisplayName('CrossFit, Lagos')).toBe('CrossFit Lagos');
    expect(safeDisplayName('24:7 Fitness')).toBe('247 Fitness');
  });

  it('drops CR/LF/tab so a name cannot inject a second header', () => {
    const out = safeDisplayName('Iron Gym\r\nBcc: everyone@example.com');
    expect(out).not.toMatch(/[\r\n\t]/);
    // With the colon gone and folded to one line, no real Bcc: header survives.
    expect(out).not.toContain('Bcc:');
  });

  it('collapses whitespace and caps the length at 60', () => {
    expect(safeDisplayName('  Iron    Republic  ')).toBe('Iron Republic');
    expect(safeDisplayName('x'.repeat(200))).toHaveLength(60);
  });
});

describe('safeLocalPart', () => {
  it('keeps a valid slug', () => {
    expect(safeLocalPart('iron-republic')).toBe('iron-republic');
  });
  it('falls back to noreply for anything not a clean DNS label', () => {
    for (const bad of ['', null, undefined, 'Iron Republic', 'bad@slug', '-lead', 'trail-']) {
      expect(safeLocalPart(bad)).toBe('noreply');
    }
  });
});

describe('gymFromAddress', () => {
  it('builds "<name> <local@domain>" for a normal gym', () => {
    expect(gymFromAddress({ name: 'Iron Republic', slug: 'iron-republic' }))
      .toMatch(/^Iron Republic <iron-republic@[^>]+>$/);
  });

  it('never emits a display name that would break the From header', () => {
    const from = gymFromAddress({ name: 'CrossFit, Lagos', slug: 'crossfit-lagos' });
    expect(displayName(from)).toBe('CrossFit Lagos');
    expect(from).toMatch(/^CrossFit Lagos <crossfit-lagos@[^>]+>$/);
  });

  it('falls back to GymFlow when the name is empty or all-specials', () => {
    expect(displayName(gymFromAddress({ name: '', slug: 'x' }))).toBe('GymFlow');
    expect(displayName(gymFromAddress({ name: '<<>>', slug: 'x' }))).toBe('GymFlow');
  });

  it('uses the shared mailbox when the slug is not a clean label', () => {
    expect(gymFromAddress({ name: 'Iron', slug: 'not a slug' })).toMatch(/^Iron <noreply@/);
  });
});

describe('EMAIL_RE', () => {
  it('accepts ordinary addresses and rejects junk / injection attempts', () => {
    for (const ok of ['a@b.co', 'ada.lovelace@gymflow.ng']) expect(EMAIL_RE.test(ok)).toBe(true);
    for (const bad of ['', 'no-at', 'a@b', 'a@b.c', 'a b@c.de', 'a@b.de, x@y.de', 'a@b.de\nBcc: c@d.de']) {
      expect(EMAIL_RE.test(bad)).toBe(false);
    }
  });
});
