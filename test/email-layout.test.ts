import { describe, expect, it } from 'vitest';
import { gymBrand, platformBrand, safeHex, readableOn, PALETTE } from '@/lib/email/brand';
import {
  renderEmail, escapeHtml, t, link, naira, strong,
  p, h1, button, panel, callout, code, small,
} from '@/lib/email/layout';

// The email layout is the one place gym-, member- and staff-controlled strings
// meet HTML. These tests pin the two properties that make that safe: nothing
// interpolated escapes escaping, and every rendered email carries a non-empty
// plain-text twin (a missing text part is a real spam signal).

const XSS = `<script>alert(1)</script>" onmouseover="x`;

describe('escapeHtml', () => {
  it('neutralises every HTML-significant character', () => {
    expect(escapeHtml(XSS)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;&quot; onmouseover=&quot;x');
  });
});

describe('the t tagged template', () => {
  it('escapes interpolated values in HTML but keeps them raw in text', () => {
    const s = t`Hello ${XSS}`;
    expect(s.html).not.toContain('<script>');
    expect(s.html).toContain('&lt;script&gt;');
    expect(s.text).toContain('<script>'); // plain text is not markup — no escaping needed
  });

  it('does not double-escape a Safe fragment passed back in', () => {
    const inner = strong('Iron & Steel');
    const s = t`Gym: ${inner}`;
    expect(s.html).toContain('Iron &amp; Steel');
    expect(s.html).not.toContain('amp;amp;');
  });
});

describe('link', () => {
  it('renders http(s) and mailto targets', () => {
    expect(link('Renew', 'https://x.ng/renew').html).toContain('href="https://x.ng/renew"');
    expect(link('Mail', 'mailto:a@b.ng').html).toContain('href="mailto:a@b.ng"');
  });

  it('refuses a javascript: URL, degrading to inert text', () => {
    const l = link('Click', 'javascript:alert(1)');
    expect(l.html).not.toContain('href');
    expect(l.html).toBe('Click');
  });

  it('escapes a crafted href so it cannot break out of the attribute', () => {
    const l = link('x', 'https://x.ng/"><script>');
    // Rejected by the URL guard (contains "), so it never becomes an anchor.
    expect(l.html).not.toContain('<script>');
  });
});

describe('naira', () => {
  it('formats with the ₦ sign and en-NG thousands separators', () => {
    expect(naira(13999).text).toBe('₦13,999');
    expect(naira(1200000).text).toBe('₦1,200,000');
  });
});

describe('renderEmail', () => {
  const brand = platformBrand();

  it('produces a full HTML document and a non-empty text twin', () => {
    const { html, text } = renderEmail({
      brand, title: 'Hi', preheader: 'preview', preferencesUrl: null,
      blocks: [h1('Welcome'), p('Body text here.'), button('Do it', 'https://x.ng/go')],
    });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Hi</title>');
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toContain('Welcome');
    expect(text).toContain('https://x.ng/go');
  });

  it('carries interpolated XSS through to neither the HTML body nor an attribute', () => {
    const { html } = renderEmail({
      brand, title: XSS, preheader: XSS, preferencesUrl: null,
      blocks: [h1(t`${XSS}`), p(t`Name: ${XSS}`)],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('onmouseover="x"');
  });

  it('uses the brand accent colour on the top rule and the button', () => {
    const gym = gymBrand({ name: 'Iron Republic', slug: 'iron', brand_color: '#ff5a1f' });
    const { html } = renderEmail({
      brand: gym, title: 'x', preferencesUrl: null,
      blocks: [button('Go', 'https://x.ng')],
    });
    expect(html).toContain('#ff5a1f');
  });

  it('omits the preferences link for critical mail (preferencesUrl null) and includes it otherwise', () => {
    const withPref = renderEmail({ brand, title: 'x', preferencesUrl: 'https://x.ng/prefs', blocks: [p('a')] });
    const withoutPref = renderEmail({ brand, title: 'x', preferencesUrl: null, blocks: [p('a')] });
    expect(withPref.html).toContain('https://x.ng/prefs');
    expect(withoutPref.html).not.toContain('/prefs');
  });

  it('emits every panel row into the text twin', () => {
    const { text } = renderEmail({
      brand, title: 'x', preferencesUrl: null,
      blocks: [panel([['Amount', naira(5000)], ['Method', 'Cash']], 'Receipt')],
    });
    expect(text).toContain('Amount');
    expect(text).toContain('₦5,000');
    expect(text).toContain('Method');
    expect(text).toContain('Cash');
  });

  it('renders callout/code/small blocks without leaking markup', () => {
    const { html, text } = renderEmail({
      brand, title: 'x', preferencesUrl: null,
      blocks: [callout('warning', 'Careful'), code('482913'), small('fine print')],
    });
    expect(html).toContain('482913');
    expect(text).toContain('482913');
    expect(text).toContain('Careful');
  });
});

describe('brand helpers', () => {
  it('safeHex accepts 3- and 6-digit hex and rejects anything else', () => {
    expect(safeHex('#ff5a1f')).toBe('#ff5a1f');
    expect(safeHex('#abc')).toBe('#aabbcc');
    expect(safeHex('red; background:url(x)')).toBe(PALETTE.brand);
    expect(safeHex(null)).toBe(PALETTE.brand);
    expect(safeHex('')).toBe(PALETTE.brand);
  });

  it('readableOn returns white on dark brand and near-black on light brand', () => {
    expect(readableOn('#0a7d52')).toBe('#ffffff');
    expect(readableOn('#c6f24e')).toBe(PALETTE.text); // volt lime → dark text
  });

  it('gymBrand rejects a non-https logo url and keeps an https one', () => {
    expect(gymBrand({ name: 'G', slug: 'g', logo_url: 'http://x/logo.png' }).logoUrl).toBeNull();
    expect(gymBrand({ name: 'G', slug: 'g', logo_url: 'https://x/logo.png' }).logoUrl).toBe('https://x/logo.png');
  });

  it('gymBrand with no gym falls back to the platform identity', () => {
    expect(gymBrand(null).isPlatform).toBe(true);
  });
});
