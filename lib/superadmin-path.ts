import type { Route } from 'next';

// Where the platform console answers.
//
// The console used to live at a guessable, publicly advertised URL: /superadmin,
// linked from the marketing footer and named in robots.txt. `requirePlatformAdmin`
// was — and still is — the thing that actually protects it, but a known door is a
// door worth knocking on: credential stuffing, session-fixation probes and
// vulnerability scanners all start from a path they can name. This moves the door
// somewhere only the people who run GymFlow know about.
//
// Two paths exist, and keeping them straight is the whole design:
//
//   • The INTERNAL route — always `/superadmin`. That is where the files live
//     (app/(superadmin)/superadmin/**), and it never changes, so rotating the
//     public URL is an env change and a redeploy, not a file move.
//
//   • The PUBLIC segment — `SUPERADMIN_PATH`. The middleware rewrites
//     `/<segment>/…` onto the internal route, and 404s anyone who asks for
//     `/superadmin` directly, so the old URL becomes indistinguishable from a
//     path that never existed.
//
// Every link inside the console must be built with `sa()`. A hard-coded
// `/superadmin/...` href would navigate the browser to the blocked path and
// 404 the admin out of their own console; test/superadmin-path.test.ts fails
// the build if one appears.

/** The internal App Router path. Not the URL anyone types. */
export const SUPERADMIN_ROUTE = '/superadmin';

/** What the segment falls back to when `SUPERADMIN_PATH` is unset or unusable. */
export const DEFAULT_SEGMENT = 'superadmin';

// A single URL path segment: lowercase alphanumerics and dashes, 3–64 chars,
// starting with an alphanumeric. Anything else is a configuration mistake —
// a slash would silently widen the rewrite to a whole subtree, and an empty
// value would mount the console at the site root.
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/**
 * Normalise a raw `SUPERADMIN_PATH` value, or null if it can't be used.
 *
 * Pure, so the rules are testable without an environment. Leading/trailing
 * slashes and whitespace are forgiven (pasting "/ops-x/" from a browser bar is
 * the obvious mistake); anything else is rejected rather than mangled into
 * something that half-works.
 */
export function normalizeSegment(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!trimmed) return null;
  return SEGMENT_RE.test(trimmed) ? trimmed : null;
}

/**
 * The public segment this deployment serves the console on.
 *
 * Falls back to `superadmin` when the env var is missing or malformed. That is
 * a deliberate fail-OPEN: the alternative is a platform admin locked out of the
 * console by a typo in an env var, with no way in to fix it. The console is
 * still gated by `requirePlatformAdmin` and the staff second factor — the secret
 * path is a lock on top of a locked door, not the lock itself — so the cost of
 * the fallback is lost obscurity, not lost authorisation.
 */
export function superadminSegment(): string {
  const configured = normalizeSegment(process.env.SUPERADMIN_PATH);
  if (configured) return configured;
  if (process.env.SUPERADMIN_PATH) {
    console.warn('[superadmin-path] SUPERADMIN_PATH is set but unusable (expected a single lowercase segment like "ops-a7f3c918"); serving the console at /superadmin.');
  }
  return DEFAULT_SEGMENT;
}

/** True when a custom segment is configured — i.e. /superadmin should 404. */
export function hasCustomSegment(): boolean {
  return superadminSegment() !== DEFAULT_SEGMENT;
}

/** The console's base URL path, e.g. `/ops-a7f3c918`. */
export function superadminBase(): string {
  return `/${superadminSegment()}`;
}

/**
 * Build a link into the console: `sa('/gyms')` → `/ops-a7f3c918/gyms`.
 *
 * The `Route` cast is the one place this is done. `typedRoutes` checks hrefs
 * against the routes that exist on disk, and the disk knows `/superadmin/gyms`,
 * not the segment this deployment happens to be serving — a URL that is only
 * known at runtime can't be verified at build time by construction.
 */
export function sa(subpath = ''): Route {
  const suffix = subpath && !subpath.startsWith('/') ? `/${subpath}` : subpath;
  return `${superadminBase()}${suffix}` as Route;
}

/**
 * Rewrite a browser path onto the internal route, or null if it isn't ours.
 *
 * `/ops-x` → `/superadmin`, `/ops-x/gyms?f=trial` → `/superadmin/gyms`. Pure and
 * exhaustively tested, because a near-miss here is either an open console or a
 * locked-out one: matching too loosely (a prefix test) would hand `/ops-xyz` to
 * the console, and matching too tightly would 404 the admin.
 */
export function internalPathFor(pathname: string, segment: string): string | null {
  const base = `/${segment}`;
  if (pathname === base) return SUPERADMIN_ROUTE;
  if (pathname.startsWith(`${base}/`)) return `${SUPERADMIN_ROUTE}${pathname.slice(base.length)}`;
  return null;
}

/** Is this browser path an attempt to reach the internal route directly? */
export function isDirectRouteHit(pathname: string): boolean {
  return pathname === SUPERADMIN_ROUTE || pathname.startsWith(`${SUPERADMIN_ROUTE}/`);
}
