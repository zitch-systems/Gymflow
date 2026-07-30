// Tenant accent handling for the public gym page (GYM-LANDING-BUILD.md §1).
//
// The whole page is themed off ONE value the gym picks. Everything else here
// derives from it, so a gym changes one setting and the page re-skins.

export const DEFAULT_ACCENT = '#11d18b';      // GymFlow emerald, for an un-themed gym
export const DEFAULT_ACCENT_INK = '#06140d';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise user input to `#rrggbb`, or null if it isn't a hex colour. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const INK_DARK = '#0a0a12';
const INK_LIGHT = '#ffffff';

/** WCAG contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Readable ink for text/icons sitting ON the accent — whichever of near-black
 *  or white actually has more contrast, not a luminance threshold.
 *
 *  A threshold gets the common gym accents wrong: ember orange #ff7a1a has a
 *  luminance of 0.35, so any midpoint rule picks white — which is 2.6:1 against
 *  the orange and fails WCAG, where near-black is 7.2:1. Measuring both and
 *  taking the winner is the same amount of code and can't be wrong. */
export function inkFor(accent: string): string {
  return contrast(accent, INK_DARK) >= contrast(accent, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/** Mix `hex` toward white by `amount` (0–1) — the lighter hover/accent-l tone. */
function lighten(hex: string, amount: number): string {
  const out = rgb(hex).map((v) => Math.round(v + (255 - v) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export type AccentVars = {
  '--accent': string;
  '--accent-l': string;
  '--accent-soft': string;
  '--accent-glow': string;
  '--accent-ink': string;
};

/** The inline custom properties for the server-rendered page wrapper. Set on the
 *  server so there is never a flash of the wrong brand colour. */
export function accentVars(accentColor: string | null | undefined, accentInk: string | null | undefined): AccentVars {
  const accent = normalizeHex(accentColor) ?? DEFAULT_ACCENT;
  const ink = normalizeHex(accentInk) ?? (accent === DEFAULT_ACCENT ? DEFAULT_ACCENT_INK : inkFor(accent));
  return {
    '--accent': accent,
    '--accent-l': lighten(accent, 0.22),
    // rgba rather than 8-digit hex: these two are composited over surfaces in
    // both themes, and the alpha needs to be explicit.
    '--accent-soft': `${accent}21`,
    '--accent-glow': `${accent}52`,
    '--accent-ink': ink,
  };
}
