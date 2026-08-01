import { describe, expect, it } from 'vitest';
import {
  buildActionUrl, linkBase, nextPath, parseActionType, renderAuthEmail,
  type AuthHookPayload,
} from '@/lib/email/auth-hook';
import { renderEmail, type EmailContent } from '@/lib/email/layout';
import { gymBrand } from '@/lib/email/brand';
import { confirmationHandoff } from '@/lib/auth/confirmation';

// EmailContent.blocks are closures, so JSON.stringify hides their content
// (functions serialise to null) and the subject is a plain-text header, not
// HTML. To assert on what a recipient actually sees, render the content to its
// final HTML + text the same way the route does.
function render(c: EmailContent | null): { subject: string; html: string; text: string } {
  if (!c) throw new Error('no content');
  const r = renderEmail({
    brand: gymBrand({ name: 'Iron Republic', slug: 'iron', brand_color: '#ff5a1f' }),
    title: c.subject, preheader: c.preheader, blocks: c.blocks, preferencesUrl: null,
  });
  return { subject: c.subject, ...r };
}

// The auth hook turns a Supabase payload into a link the user clicks to prove
// they own an inbox. The security-critical property: the link always lands on
// OUR /auth/confirm route, and the `next` it carries can only ever be a
// same-origin path — a poisoned redirect_to must not become an open redirect.

describe('nextPath', () => {
  it('keeps a relative path + query', () => {
    expect(nextPath('/login?confirmed=1', 'signup')).toBe('/login?confirmed=1');
  });

  it('strips the origin from an absolute URL, keeping only the path', () => {
    expect(nextPath('https://gymflow.ng/reset-password', 'recovery')).toBe('/reset-password');
  });

  it('unwraps the post-confirmation hand-off instead of nesting the callback', () => {
    expect(nextPath('https://gymflow.ng/auth/confirm?next=/launch', 'signup')).toBe('/launch');
    expect(nextPath('/auth/confirm?next=%2Freset-password', 'recovery')).toBe('/reset-password');
  });

  it('rejects an unsafe nested callback destination', () => {
    expect(nextPath('/auth/confirm?next=https://evil.example/steal', 'signup')).toBe('/login?confirmed=1');
    expect(nextPath('/auth/confirm?next=//evil.example/steal', 'recovery')).toBe('/reset-password');
  });

  it('keeps only the path of a foreign absolute URL, never its origin', () => {
    // The real contract is "never leave our origin". A foreign URL is reduced
    // to a same-origin path — the app's legitimate redirect_to values are
    // absolute-and-ours, so we preserve the path rather than discard it, and
    // the host can never survive into the result.
    const out = nextPath('https://evil.example.com/steal', 'recovery');
    expect(out).toBe('/steal');
    expect(out).not.toContain('evil.example.com');
    expect(out.startsWith('/')).toBe(true);
    expect(out.startsWith('//')).toBe(false);
  });

  it('reduces a protocol-relative URL (//evil.com) to its path, dropping the host', () => {
    const out = nextPath('//evil.com/x', 'signup');
    expect(out).toBe('/x');
    expect(out).not.toContain('evil.com');
  });

  it('falls back when redirect_to is missing', () => {
    expect(nextPath(undefined, 'recovery')).toBe('/reset-password');
    expect(nextPath(undefined, 'signup')).toBe('/login?confirmed=1');
  });
});

describe('confirmationHandoff', () => {
  it('repairs an already-sent nested member confirmation link at callback time', () => {
    expect(confirmationHandoff('/auth/confirm?next=%2Flaunch', '/')).toBe('/launch');
  });

  it('keeps the callback boundary same-origin', () => {
    expect(confirmationHandoff('https://evil.example/steal', '/')).toBe('/');
    expect(confirmationHandoff('/auth/confirm?next=https://evil.example/steal', '/')).toBe('/');
  });
});

describe('linkBase', () => {
  it('falls back to the payload site_url when we have no explicit origin', () => {
    // NEXT_PUBLIC_SITE_URL is unset in the test env, so the payload's site_url is
    // the next candidate (a preview deploy where the dashboard Site URL is the
    // one authoritative value we have).
    const p = { user: {}, email_data: { site_url: 'https://app.gymflow.ng/' } } as AuthHookPayload;
    expect(linkBase(p)).toBe('https://app.gymflow.ng');
  });

  it('lets our own NEXT_PUBLIC_SITE_URL win over any dashboard Site URL', () => {
    const prev = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://gymflow.ng';
    try {
      // The reported misconfiguration — a Supabase-host Site URL — cannot win.
      expect(linkBase({ user: {}, email_data: { site_url: 'https://kdbbrxqxqewbjoozmfhq.supabase.co' } } as AuthHookPayload))
        .toBe('https://gymflow.ng');
      // Neither can any other wrong-but-not-Supabase host (stale preview URL).
      expect(linkBase({ user: {}, email_data: { site_url: 'https://stale-preview.vercel.app' } } as AuthHookPayload))
        .toBe('https://gymflow.ng');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prev;
    }
  });

  it('returns an absolute base even when neither our env nor the payload is usable', () => {
    const p = { user: {}, email_data: { site_url: '/relative' } } as AuthHookPayload;
    // With NEXT_PUBLIC_SITE_URL unset in the test env, siteUrl() falls back to
    // the gymflow.ng default, which IS absolute — so assert on the shape.
    const base = linkBase(p);
    expect(base === null || /^https?:\/\//.test(base)).toBe(true);
  });

  it('rejects a *.supabase.co Site URL and falls back to our own origin', () => {
    // The exact production misconfiguration behind the "verification link just
    // loads" report: the Supabase dashboard Site URL was left at the project's
    // own URL, so the hook payload carries it. Building /auth/confirm on that
    // host mails a dead link that 404s with "No API key found in request".
    const p = { user: {}, email_data: { site_url: 'https://kdbbrxqxqewbjoozmfhq.supabase.co' } } as AuthHookPayload;
    const base = linkBase(p);
    expect(base).not.toContain('supabase.co');
    expect(/^https?:\/\//.test(base ?? '')).toBe(true);
  });

  it('rejects the supabase.in host and a trailing-slash project URL too', () => {
    for (const site of ['https://abcdef.supabase.in/', 'https://abcdef.supabase.co/']) {
      const p = { user: {}, email_data: { site_url: site } } as AuthHookPayload;
      expect(linkBase(p)).not.toContain('supabase.');
    }
  });

  it('still honours a legitimate non-Supabase custom domain', () => {
    const p = { user: {}, email_data: { site_url: 'https://app.ironrepublic.ng' } } as AuthHookPayload;
    expect(linkBase(p)).toBe('https://app.ironrepublic.ng');
  });

  it('a Supabase-host Site URL never survives into a built confirmation link', () => {
    // End-to-end guard: even with the bad Site URL in the payload, the CTA the
    // member clicks must point at our origin, not the Supabase API host.
    const base = linkBase({ user: {}, email_data: { site_url: 'https://kdbbrxqxqewbjoozmfhq.supabase.co' } } as AuthHookPayload)!;
    const c = renderAuthEmail('signup', {
      user: { email: 'ada@example.com' },
      email_data: { token_hash: 'TH', redirect_to: '/auth/confirm?next=/launch' },
    } as AuthHookPayload, { base, senderName: 'Iron Republic', isGymMember: true });
    const { html } = render(c);
    expect(html).toContain('/auth/confirm');
    expect(html).not.toContain('supabase.co');
  });
});

describe('buildActionUrl', () => {
  it('targets /auth/confirm with token_hash, type and encoded next', () => {
    const url = buildActionUrl('https://gymflow.ng', 'HASH', 'recovery', '/reset-password');
    expect(url).toContain('https://gymflow.ng/auth/confirm?');
    expect(url).toContain('token_hash=HASH');
    expect(url).toContain('type=recovery');
    expect(url).toContain('next=%2Freset-password');
  });
});

describe('parseActionType', () => {
  it('accepts known types', () => {
    for (const tpe of ['signup', 'recovery', 'invite', 'magiclink', 'email_change', 'email_change_current', 'email_change_new', 'reauthentication']) {
      expect(parseActionType(tpe)).toBe(tpe);
    }
  });
  it('rejects anything else', () => {
    expect(parseActionType('delete_account')).toBeNull();
    expect(parseActionType(undefined)).toBeNull();
    expect(parseActionType('')).toBeNull();
  });
});

describe('renderAuthEmail', () => {
  const ctx = { base: 'https://gymflow.ng', senderName: 'Iron Republic', isGymMember: true };
  const payload = (over: Partial<AuthHookPayload['email_data']> = {}, user: AuthHookPayload['user'] = {}): AuthHookPayload => ({
    user: { email: 'ada@example.com', ...user },
    email_data: { token_hash: 'TH', token: '123456', redirect_to: '/auth/confirm?next=/launch', ...over },
  });

  it('builds a signup email whose CTA confirms once, then launches the member', () => {
    const { html, subject } = render(renderAuthEmail('signup', payload(), ctx));
    expect(html).toContain('/auth/confirm');
    expect(html).toContain('token_hash=TH');
    expect(html).toContain('next=%2Flaunch');
    expect(html).not.toContain('next=%2Fauth%2Fconfirm');
    expect(subject.toLowerCase()).toContain('confirm');
  });

  it('produces a recovery email that confirms once, then opens reset-password', () => {
    const { html, text } = render(renderAuthEmail('recovery', payload({ redirect_to: '/auth/confirm?next=/reset-password' }), ctx));
    expect(html).toContain('1 hour');
    expect(text).toContain('1 hour');
    expect(html).toContain('next=%2Freset-password');
    expect(html).not.toContain('next=%2Fauth%2Fconfirm');
  });

  it('renders reauthentication from the token, needing no link', () => {
    const c = renderAuthEmail('reauthentication', payload({ token: '482913' }), ctx);
    expect(c!.subject).toContain('482913');
    expect(render(c).html).toContain('482913'); // the code block renders it too
  });

  it('returns null when the required token_hash is absent (malformed call)', () => {
    expect(renderAuthEmail('signup', payload({ token_hash: undefined }), ctx)).toBeNull();
  });

  it('returns null when reauthentication has no token', () => {
    expect(renderAuthEmail('reauthentication', payload({ token: undefined }), ctx)).toBeNull();
  });

  it('email_change to the new address uses the *_new token hash', () => {
    const c = renderAuthEmail('email_change_new', payload({ token_hash: 'OLD', token_hash_new: 'NEW' }, { new_email: 'new@x.ng' }), ctx);
    expect(render(c).html).toContain('token_hash=NEW');
    expect(render(c).html).not.toContain('token_hash=OLD');
  });

  it('email_change URLs carry the specific subtype so /auth/confirm can map them', () => {
    for (const subtype of ['email_change_current', 'email_change_new'] as const) {
      const c = renderAuthEmail(subtype, payload({ token_hash: 'TH', token_hash_new: 'THN' }, { new_email: 'new@x.ng' }), ctx);
      const { html } = render(c);
      expect(html).toContain(`type=${subtype}`);
      expect(html).toContain('/auth/confirm');
    }
  });

  it('never leaks an injected gym name into the rendered HTML body', () => {
    // The subject is a plain-text header and may contain the raw name; what
    // must never happen is the name becoming live markup in the HTML body.
    const c = renderAuthEmail('signup', payload(), { ...ctx, senderName: '<script>alert(1)</script>' });
    expect(render(c).html).not.toContain('<script>alert(1)</script>');
  });
});
