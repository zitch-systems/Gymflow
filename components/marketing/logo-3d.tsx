'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Logo3D — an animated, genuinely 3D rebuild of the GymFlow logomark
// (public/images/logomark-v2.svg). The three bars are stacked at different
// translateZ depths inside a `preserve-3d` scene, so the idle tumble and the
// pointer-driven tilt reveal real parallax between them — not a flat rotation.
//
// Pure CSS/HTML (no SVG, no canvas) so it renders server-side and animates with
// zero JS; the tiny effect below only adds the optional pointer-tilt and is a
// no-op under `prefers-reduced-motion`. Geometry mirrors the SVG's 48-unit
// viewBox, scaled to `size`. Decorative — paired with the visible wordmark.
// ───────────────────────────────────────────────────────────────────────────

// Bars from logomark-v2.svg, with the group's translate(3,0) baked into `left`.
// Depth grows with height so the tall volt bar pops furthest toward the viewer.
const BARS = [
  { left: 16, top: 25, w: 6.5, h: 11, color: 'rgba(255,255,255,0.92)', depth: 0.1 },
  { left: 25, top: 17, w: 6.5, h: 19, color: '#ffffff', depth: 0.24 },
  { left: 34, top: 9, w: 6.5, h: 27, color: '#c6f24e', depth: 0.42 },
] as const;

export function Logo3D({ size = 30 }: { size?: number }) {
  const sceneRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    // While hovering, tilt toward the pointer; CSS transitions ease it back.
    const onMove = (e: PointerEvent) => {
      const r = scene.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      scene.style.setProperty('--rx', `${Math.max(-32, Math.min(32, -dy * 34))}deg`);
      scene.style.setProperty('--ry', `${Math.max(-36, Math.min(36, dx * 40))}deg`);
    };
    const reset = () => {
      scene.style.setProperty('--rx', '0deg');
      scene.style.setProperty('--ry', '0deg');
    };

    scene.addEventListener('pointermove', onMove);
    scene.addEventListener('pointerleave', reset);
    return () => {
      scene.removeEventListener('pointermove', onMove);
      scene.removeEventListener('pointerleave', reset);
    };
  }, []);

  const u = size / 48; // SVG units → px

  return (
    <span
      ref={sceneRef}
      className="logo3d"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* card: pointer-tilt layer (driven by --rx/--ry CSS vars) */}
      <span className="logo3d-card">
        {/* spin: idle 3D float layer */}
        <span className="logo3d-spin">
          <span className="logo3d-face" style={{ borderRadius: 13 * u }} />
          {BARS.map((b, i) => (
            <span
              key={i}
              className="logo3d-bar"
              style={{
                left: b.left * u,
                top: b.top * u,
                width: b.w * u,
                height: b.h * u,
                borderRadius: 3.25 * u,
                background: b.color,
                transform: `translateZ(${b.depth * size}px) skewX(-9deg)`,
              }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}
