// The canonical public origin of the app (scheme + host, no trailing slash).
//
// Every top-level module-eval caller — root layout metadata, robots, sitemap,
// pricing structured data — needs a value it can hand to `new URL()` without
// crashing the build. `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gymflow.ng'`
// only catches `undefined`, not empty strings or schemeless values, and a bad
// value fails page-data collection with `TypeError: Invalid URL` — silent in
// dev, fatal in `next build`. Parse-and-fallback is the only safe form.

const FALLBACK = 'https://gymflow.ng';

function safeParse(raw: string | undefined): string {
  const v = raw?.trim();
  if (!v) return FALLBACK;
  try {
    return new URL(v).toString().replace(/\/$/, '');
  } catch {
    return FALLBACK;
  }
}

export const SITE_URL = safeParse(process.env.NEXT_PUBLIC_SITE_URL);
