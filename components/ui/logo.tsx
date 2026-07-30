// The Flowbell mark — GymFlow's logo, and the ONLY place its geometry appears in
// TS/TSX. Every surface imports this; nothing re-declares the paths inline.
//
// A dumbbell whose bar has become a single-period wave: four vertical plates
// (outer pair 18u tall, inner pair 32u) on a 64-unit grid, with the wave sweeping
// between the inner two. The wave is drawn a third lighter than the plates
// (3.2 vs 4.6) — that weight contrast is the whole idea, so don't equalise them.
//
// Colour comes from `currentColor`, so each surface sets it in plain CSS:
// emerald on dark and on white, near-black on an emerald fill, white on
// photography. Never hardcode a hex here, never wrap the mark in a coloured tile
// (the old mark was a white glyph on an emerald gradient — Flowbell is the
// inverse), never gradient it.

const WAVE = 'M20 32 C 23 23.5, 29 23.5, 32 32 S 41 40.5, 44 32';
const PLATES = ['M11 23 V41', 'M19 16 V48', 'M45 16 V48', 'M53 23 V41'];

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 64 64" fill="none"
      className={className} aria-hidden focusable="false"
    >
      <g stroke="currentColor" strokeLinecap="round" fill="none">
        <path d={WAVE} strokeWidth={3.2} />
        <g strokeWidth={4.6}>
          {PLATES.map((d) => <path key={d} d={d} />)}
        </g>
      </g>
    </svg>
  );
}

/** Mark + wordmark. Use anywhere the full lockup is shown. */
export function LogoLockup({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `gf-logo ${className}` : 'gf-logo'}>
      <LogoMark size={size} />
      <span className="gf-logo-text">Gym<em>Flow</em></span>
    </span>
  );
}
