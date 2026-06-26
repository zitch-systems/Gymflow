'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Logo3D — an animated, genuinely 3D rebuild of the GymFlow logomark
// (public/images/logomark-v3.svg). The three bars are stacked at different
// translateZ depths inside a `preserve-3d` scene, so the idle tumble and the
// pointer-driven tilt reveal real parallax between them — not a flat rotation.
//
// Pure CSS/HTML (no SVG, no canvas) so it renders server-side and animates with
// zero JS; the tiny effect below only adds the optional pointer-tilt and is a
// no-op under `prefers-reduced-motion`. Geometry mirrors the SVG's 48-unit
// viewBox, scaled to `size`. Decorative — paired with the visible wordmark.
// ───────────────────────────────────────────────────────────────────────────

// Three equal bars from logomark-v3.svg, dark→bright green left→right. Depth
// grows left→right so the brightest bar sits furthest toward the viewer, giving
// real parallax as the mark tumbles / tilts.
const BARS = [
  { left: 12.5, grad: 'linear-gradient(180deg, #0a5e44, #0f8862)', depth: 0.12 },
  { left: 21, grad: 'linear-gradient(180deg, #0f9f6e, #1ac98a)', depth: 0.26 },
  { left: 29.5, grad: 'linear-gradient(180deg, #22d093, #52edb2)', depth: 0.42 },
] as const;
const BAR_W = 6, BAR_H = 22, BAR_TOP = 13; // 48-unit grid, equal bars

export function Logo3D({ size = 30, className }: { size?: number; className?: string }) {
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
      className={className ? `logo3d ${className}` : 'logo3d'}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* card: pointer-tilt layer (driven by --rx/--ry CSS vars) */}
      <span className="logo3d-card">
        {/* spin: idle 3D float layer */}
        <span className="logo3d-spin">
          <span className="logo3d-face" style={{ borderRadius: 11 * u }} />
          {BARS.map((b, i) => (
            <span
              key={i}
              className="logo3d-bar"
              style={{
                left: b.left * u,
                top: BAR_TOP * u,
                width: BAR_W * u,
                height: BAR_H * u,
                borderRadius: (BAR_W / 2) * u,
                background: b.grad,
                transform: `translateZ(${b.depth * size}px) skewX(-7deg)`,
              }}
            />
          ))}
        </span>
      </span>
    </span>
  );
}
