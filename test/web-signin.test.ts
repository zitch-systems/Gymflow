import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gymLaunchUrl, gymSignInUrl, isPlatformWebsite, memberBelongsOnGymSite } from '../lib/web-signin';

// GymFlow's website is for the people who RUN gyms. A gym's members sign in on
// that gym's own page (<slug>.gymflow.ng) or in the Android app.
//
// The interesting cases are all the ones where the rule must NOT fire:
//
//   • Staff who are also members of their own gym — an owner who trains where
//     they work. Sending them to the member sign-in would lock them out of the
//     business they own, and they are the single most likely person to hold
//     both link types.
//   • Anyone at all on localhost or a preview deploy, where subdomains don't
//     resolve and the redirect target would be a dead host.
//   • A member whose gym has no usable slug — there is nowhere to send them.
//
// The rule fires in exactly one case, and this is the file that says so.

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'gymflow.ng';

const MEMBER = { isPlatformAdmin: false, isStaff: false, memberGymSlug: 'iron-republic' };

describe('isPlatformWebsite', () => {
  it('is true for the apex and www', () => {
    expect(isPlatformWebsite(ROOT)).toBe(true);
    expect(isPlatformWebsite(`www.${ROOT}`)).toBe(true);
    expect(isPlatformWebsite(`${ROOT}:443`)).toBe(true);
    expect(isPlatformWebsite(ROOT.toUpperCase())).toBe(true);
  });

  it('is false for a gym subdomain — that IS the member sign-in', () => {
    expect(isPlatformWebsite(`iron-republic.${ROOT}`)).toBe(false);
  });

  it('is false for dev and preview hosts, where subdomains do not resolve', () => {
    expect(isPlatformWebsite('localhost:3000')).toBe(false);
    expect(isPlatformWebsite('127.0.0.1:3000')).toBe(false);
    expect(isPlatformWebsite('gymflow-git-branch-team.vercel.app')).toBe(false);
    expect(isPlatformWebsite(null)).toBe(false);
    expect(isPlatformWebsite('')).toBe(false);
  });

  it('is false for a lookalike host', () => {
    // A spoofed Host header must not turn into "this is the apex, redirect".
    expect(isPlatformWebsite(`evil-${ROOT}`)).toBe(false);
    expect(isPlatformWebsite(`${ROOT}.attacker.test`)).toBe(false);
  });
});

describe('memberBelongsOnGymSite', () => {
  it('sends a member-only account off the platform website', () => {
    expect(memberBelongsOnGymSite(ROOT, MEMBER)).toBe(true);
    expect(memberBelongsOnGymSite(`www.${ROOT}`, MEMBER)).toBe(true);
  });

  it('leaves staff alone, including staff who are members of their own gym', () => {
    // The owner who trains at their own gym. Both links, and they need /admin.
    expect(memberBelongsOnGymSite(ROOT, { ...MEMBER, isStaff: true })).toBe(false);
    expect(memberBelongsOnGymSite(ROOT, { ...MEMBER, isPlatformAdmin: true })).toBe(false);
  });

  it('leaves members alone on their own gym page', () => {
    expect(memberBelongsOnGymSite(`iron-republic.${ROOT}`, MEMBER)).toBe(false);
  });

  it('leaves everyone alone in dev and preview', () => {
    expect(memberBelongsOnGymSite('localhost:3000', MEMBER)).toBe(false);
    expect(memberBelongsOnGymSite('gymflow-git-branch-team.vercel.app', MEMBER)).toBe(false);
  });

  it('leaves a member alone when their gym cannot be named', () => {
    // Nowhere to send them: a redirect to a URL that doesn't resolve is worse
    // than letting them through to the dashboard they already had.
    expect(memberBelongsOnGymSite(ROOT, { ...MEMBER, memberGymSlug: null })).toBe(false);
    expect(memberBelongsOnGymSite(ROOT, { ...MEMBER, memberGymSlug: '' })).toBe(false);
    expect(memberBelongsOnGymSite(ROOT, { ...MEMBER, memberGymSlug: 'not a slug' })).toBe(false);
    expect(memberBelongsOnGymSite(ROOT, { ...MEMBER, memberGymSlug: '../etc' })).toBe(false);
  });
});

describe('redirect targets', () => {
  it('point at the gym host, not the apex', () => {
    expect(gymSignInUrl('iron-republic')).toBe(`https://iron-republic.${ROOT}/login`);
    expect(gymLaunchUrl('iron-republic')).toBe(`https://iron-republic.${ROOT}/launch`);
  });
});

// ── The boundary is the DAL, not the form ─────────────────────────────────
//
// /login and /launch route people to the right host. Neither is a boundary: a
// session minted before this rule existed, or by a path that doesn't pass
// through them, would still open the member surfaces on the apex. requireMember
// is what actually holds the line, and it holds it for every member page at
// once — so it has to keep doing it.

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the member surfaces enforce it too', () => {
  it('requireMember redirects a member off the platform website', () => {
    const dal = read('lib/auth/dal.ts');
    const body = dal.slice(dal.indexOf('export const requireMember'), dal.indexOf('const resolveStaff'));
    expect(body).toContain('memberBelongsOnGymSite');
    expect(body).toContain('gymLaunchUrl');
  });

  it('sign-in drops the session it just minted rather than leaving one on the apex', () => {
    const actions = read('lib/auth/actions.ts');
    const signIn = actions.slice(actions.indexOf('export async function signIn'), actions.indexOf('export async function verifyTwoFactor'));
    expect(signIn).toContain('member_site');
    // The order matters: sign out, THEN report. Returning first would leave an
    // apex session behind for the browser to keep using.
    expect(signIn.indexOf('signOut()')).toBeLessThan(signIn.indexOf("code: 'member_site'"));
  });

  it('/launch sends members to their gym rather than the apex dashboard', () => {
    expect(read('app/launch/page.tsx')).toContain('memberBelongsOnGymSite');
  });
});
