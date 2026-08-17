import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEGMENT, SUPERADMIN_ROUTE,
  internalPathFor, isDirectRouteHit, normalizeSegment,
} from '../lib/superadmin-path';

// The platform console moved off /superadmin onto a secret, env-configured path.
//
// Two ways that can go wrong, and neither shows up in a single file:
//
//   • The rewrite matches too loosely and hands the console to a path that
//     merely starts with the segment, or too tightly and 404s the admin out of
//     their own console. That's the first block — pure function, exhaustive.
//
//   • A link somewhere still points at the literal /superadmin. It would look
//     fine in review and in local dev (where the fallback keeps that path
//     alive), then dead-end every platform admin in production. That's the
//     second block.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

describe('normalizeSegment', () => {
  it('accepts a plain segment', () => {
    expect(normalizeSegment('ops-a7f3c918')).toBe('ops-a7f3c918');
    expect(normalizeSegment('console2026')).toBe('console2026');
  });

  it('forgives the paste-from-the-address-bar shapes', () => {
    expect(normalizeSegment('/ops-a7f3c918')).toBe('ops-a7f3c918');
    expect(normalizeSegment('/ops-a7f3c918/')).toBe('ops-a7f3c918');
    expect(normalizeSegment('  OPS-A7F3C918  ')).toBe('ops-a7f3c918');
  });

  it('rejects anything that would widen or move the mount point', () => {
    // A slash would rewrite a whole subtree, not one segment.
    expect(normalizeSegment('ops/secret')).toBeNull();
    // Empty would mount the console at the site root.
    expect(normalizeSegment('')).toBeNull();
    expect(normalizeSegment('   ')).toBeNull();
    expect(normalizeSegment(null)).toBeNull();
    expect(normalizeSegment(undefined)).toBeNull();
    // Too short to be worth calling a secret.
    expect(normalizeSegment('ab')).toBeNull();
    // Characters that don't survive a URL intact.
    expect(normalizeSegment('ops secret')).toBeNull();
    expect(normalizeSegment('ops?f=1')).toBeNull();
    expect(normalizeSegment('ops.secret')).toBeNull();
    expect(normalizeSegment('-ops')).toBeNull();
    expect(normalizeSegment('../etc')).toBeNull();
  });
});

describe('internalPathFor', () => {
  const seg = 'ops-a7f3c918';

  it('maps the base and its children onto the internal route', () => {
    expect(internalPathFor(`/${seg}`, seg)).toBe(SUPERADMIN_ROUTE);
    expect(internalPathFor(`/${seg}/gyms`, seg)).toBe('/superadmin/gyms');
    expect(internalPathFor(`/${seg}/gyms/abc-123`, seg)).toBe('/superadmin/gyms/abc-123');
  });

  it('does not match a path that merely starts with the segment', () => {
    // The bug a `startsWith` implementation would ship: /ops-a7f3c918-old, or
    // someone else's /ops-a7f3c918x, quietly resolving to the console.
    expect(internalPathFor(`/${seg}x`, seg)).toBeNull();
    expect(internalPathFor(`/${seg}-old`, seg)).toBeNull();
    expect(internalPathFor(`/${seg}extra/gyms`, seg)).toBeNull();
  });

  it('leaves every other path alone', () => {
    expect(internalPathFor('/', seg)).toBeNull();
    expect(internalPathFor('/pricing', seg)).toBeNull();
    expect(internalPathFor('/admin/members', seg)).toBeNull();
    expect(internalPathFor('/superadmin', seg)).toBeNull();
  });
});

describe('isDirectRouteHit', () => {
  it('catches the retired URL and its children', () => {
    expect(isDirectRouteHit('/superadmin')).toBe(true);
    expect(isDirectRouteHit('/superadmin/gyms')).toBe(true);
    expect(isDirectRouteHit('/superadmin/gyms/abc-123')).toBe(true);
  });

  it('does not catch unrelated paths that share the prefix', () => {
    expect(isDirectRouteHit('/superadmins')).toBe(false);
    expect(isDirectRouteHit('/superadmin-help')).toBe(false);
    expect(isDirectRouteHit('/admin')).toBe(false);
  });

  it('agrees with the fallback', () => {
    // With no env configured the segment IS the internal route, so the two
    // functions must not disagree about the same path.
    expect(internalPathFor(SUPERADMIN_ROUTE, DEFAULT_SEGMENT)).toBe(SUPERADMIN_ROUTE);
  });
});

// ── No literal /superadmin links anywhere ─────────────────────────────────
//
// Every href, redirect and form action into the console must be built through
// sa() / superadminBase(). A literal one still resolves in local dev (where
// SUPERADMIN_PATH is usually unset and the fallback keeps /superadmin alive),
// so this is the only thing standing between a stray link and a production
// console that 404s the moment anyone clicks it.

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root(dir))) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(root(rel)).isDirectory()) sourceFiles(rel, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(rel);
  }
  return acc;
}

// The files allowed to name the internal route, and why.
const ALLOWED = new Set([
  'lib/superadmin-path.ts', // defines it
  'middleware.ts',          // rewrites onto it, and 404s direct hits
]);

// href="/superadmin…", href={`/superadmin…`}, redirect('/superadmin…'),
// action="/superadmin…" — a link, not a comment or a route-group folder name.
const LINK_RE = /(?:href|action)\s*=\s*[{"'`]+\/superadmin|redirect\(\s*['"`]\/superadmin/;

describe('nothing links to the internal console route', () => {
  const files = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]
    .filter((f) => !ALLOWED.has(f));

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds no hard-coded console link', () => {
    const offenders = files.filter((f) => LINK_RE.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('keeps the console out of robots.txt', () => {
    // robots.txt is public: naming the live path would publish it, and naming
    // the retired one advertises that something used to be there. Only the
    // emitted disallow list matters — the prose above it may explain why.
    const disallow = /disallow:\s*\[([^\]]*)\]/.exec(read('app/robots.ts'))?.[1] ?? '';
    expect(disallow).not.toContain('superadmin');
    expect(disallow).not.toContain('SUPERADMIN_PATH');
  });

  it('keeps the console out of the public marketing chrome', () => {
    expect(read('components/marketing/chrome.tsx')).not.toContain('Platform admin</Link>');
  });
});
