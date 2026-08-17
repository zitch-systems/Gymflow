// Renders the Android app icons from the Flowbell mark.
//
//   node mobile/scripts/generate-icons.mjs        (run from the repo root)
//
// The geometry below is copied from components/ui/logo.tsx, which is the single
// source for the mark everywhere else. It is duplicated here — and only here —
// because this script produces PNGs at build-asset time, not React at runtime;
// if the mark ever changes, change it there first and re-run this.
//
// Brand rules that shaped these files (see the comment in logo.tsx): the mark is
// emerald on dark, never gradiented, and never wrapped in a coloured tile —
// Flowbell is the inverse of the old white-glyph-on-emerald treatment. The dark
// rounded tile here matches app/icon.svg, which is the web favicon's treatment
// of exactly the same mark, so the phone icon and the browser tab agree.

import { Buffer } from 'node:buffer';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Resolved from the repo root's node_modules — this script is run from there,
// and the mobile app has no need for sharp of its own.
import sharp from 'sharp';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');
mkdirSync(OUT, { recursive: true });

const BRAND = '#11d18b';
const BG = '#0a0a12';

const WAVE = 'M20 32 C 23 23.5, 29 23.5, 32 32 S 41 40.5, 44 32';
const PLATES = ['M11 23 V41', 'M19 16 V48', 'M45 16 V48', 'M53 23 V41'];

/** The mark on a 64-unit grid, in one colour. */
const mark = (color) => `
  <g stroke="${color}" stroke-linecap="round" fill="none">
    <path d="${WAVE}" stroke-width="3.2"/>
    <g stroke-width="4.6">${PLATES.map((d) => `<path d="${d}"/>`).join('')}</g>
  </g>`;

/**
 * `scale` shrinks the 64-unit mark inside the canvas and centres it.
 *
 * Android masks adaptive icons to a shape it chooses (circle, squircle, …) and
 * only the middle ~66% is guaranteed visible, so the foreground layer draws the
 * mark at 52% and lets the rest be margin. The full-bleed tile can go bigger
 * because nothing crops it.
 */
const canvas = (scale, color, { tile = false } = {}) => {
  const size = 1024;
  const marked = 64 / scale;                 // grid units the canvas represents
  const offset = (marked - 64) / 2;          // centres the 64-unit mark in it
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-offset} ${-offset} ${marked} ${marked}">
    ${tile ? `<rect x="${-offset}" y="${-offset}" width="${marked}" height="${marked}" rx="${marked * 0.22}" fill="${BG}"/>` : ''}
    ${mark(color)}
  </svg>`;
};

const files = [
  // Launcher icon / iOS / Play listing fallback: the mark on the dark tile.
  ['icon.png', canvas(0.62, BRAND, { tile: true }), 1024],
  // Adaptive foreground: mark only, transparent, inside the safe zone. The
  // background colour comes from app.json (adaptiveIcon.backgroundColor).
  ['android-icon-foreground.png', canvas(0.52, BRAND), 1024],
  // Themed icons: Android tints the alpha, so the colour here is irrelevant —
  // only the silhouette is. Same safe zone as the foreground.
  ['android-icon-monochrome.png', canvas(0.52, '#ffffff'), 1024],
  // Splash: sits on BG (app.json), rendered at 120dp, so no tile of its own.
  ['splash-icon.png', canvas(0.70, BRAND), 512],
];

for (const [name, svg, size] of files) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(resolve(OUT, name));
  console.log(`wrote ${name} (${size}×${size})`);
}
