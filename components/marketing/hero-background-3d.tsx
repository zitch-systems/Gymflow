'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Hero 3D background — a real 3D scene drawn on a <canvas> with the plain 2D
// API and hand-rolled perspective projection. No three.js / WebGL: the whole
// thing is a few hundred bytes of math, which keeps the marketing bundle lean
// (on-brand: "light enough to fly on Nigerian networks").
//
// What you see: three tumbling orbit rings (the "flow") wrapped in a depth-
// faded particle constellation, tinted with the GymFlow emerald → volt palette.
// The scene slowly auto-rotates and parallax-tilts toward the pointer.
//
// Good-citizen behaviour: caps DPR, pauses when the tab is hidden or the hero
// scrolls out of view, re-reads brand tokens on theme switch, and renders a
// single static frame (no loop) when the user prefers reduced motion.
// ───────────────────────────────────────────────────────────────────────────

type P3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

type Ring = {
  r: number; // radius
  tiltX: number; // fixed orientation of the ring's plane
  tiltZ: number;
  spin: number; // own spin speed (rad/s) around its normal
  seg: number; // segment count
  kind: 'volt' | 'emerald'; // resolved to the live palette each frame
  alpha: number;
};

const FOV = 2.7; // smaller = stronger perspective foreshortening

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function parseRGB(v: string): RGB | null {
  const m = v.split(',').map((s) => Number(s.trim()));
  return m.length === 3 && m.every((n) => Number.isFinite(n)) ? (m as RGB) : null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

// Uniformly-distributed point inside a sphere of the given radius.
function randInSphere(radius: number): P3 {
  let x = 0, y = 0, z = 0, d = 2;
  while (d > 1 || d === 0) {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    z = Math.random() * 2 - 1;
    d = x * x + y * y + z * z;
  }
  const r = Math.cbrt(Math.random()) * radius;
  const s = r / Math.sqrt(d);
  return { x: x * s, y: y * s, z: z * s };
}

// Elementary rotations (return new points).
const rotX = (p: P3, a: number): P3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
};
const rotY = (p: P3, a: number): P3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
};
const rotZ = (p: P3, a: number): P3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
};

export function HeroBackground3D() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── palette (re-read on theme change) ───────────────────────────────────
    let emerald: RGB = [17, 209, 139];
    let volt: RGB = [198, 242, 78];
    let intensity = 1; // dial the whole thing back on the light theme
    const readTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      emerald = parseRGB(cs.getPropertyValue('--gf-brand-rgb')) ?? emerald;
      volt = parseRGB(cs.getPropertyValue('--gf-accent-rgb')) ?? volt;
      intensity = document.documentElement.getAttribute('data-theme') === 'light' ? 0.55 : 1;
    };
    readTheme();
    const themeObs = new MutationObserver(readTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── sizing ──────────────────────────────────────────────────────────────
    let w = 0, h = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduceMotion) renderFrame(0.6, -0.34, 0); // keep static frame crisp
    };

    // ── geometry ────────────────────────────────────────────────────────────
    const ringDefs: Ring[] = [
      { r: 0.62, tiltX: 1.15, tiltZ: 0.2, spin: 0.32, seg: 76, kind: 'volt', alpha: 0.9 },
      { r: 0.9, tiltX: 0.5, tiltZ: -0.55, spin: -0.22, seg: 88, kind: 'emerald', alpha: 0.8 },
      { r: 1.16, tiltX: 1.5, tiltZ: 0.9, spin: 0.16, seg: 100, kind: 'emerald', alpha: 0.55 },
    ];

    let particles: P3[] = [];
    const buildParticles = () => {
      const n = Math.round(Math.min(170, Math.max(60, (w * h) / 8200)));
      particles = Array.from({ length: n }, () => randInSphere(1.25));
    };

    // ── projection ──────────────────────────────────────────────────────────
    // Returns screen position + a depth-derived scale for a world-space point,
    // after the global tumble (rotY then rotX) and pointer parallax.
    let parX = 0, parY = 0; // eased pointer offset, -1..1
    const project = (p: P3, ry: number, rx: number) => {
      const a = rotX(rotY(p, ry), rx);
      const scale = FOV / (FOV + a.z);
      const R = Math.min(w, h) * 0.46;
      return {
        x: w / 2 + a.x * R * scale + parX * 30,
        y: h / 2 * 0.96 + a.y * R * scale + parY * 22,
        scale,
        z: a.z,
      };
    };

    // Fade everything out near the top/bottom edges so the canvas melts into the
    // hero's photo + gradient instead of ending in a hard line.
    const edgeFade = (y: number) =>
      Math.min(clamp01(y / (h * 0.18)), clamp01((h - y) / (h * 0.3)));

    // ── one frame ───────────────────────────────────────────────────────────
    const renderFrame = (ry: number, rx: number, t: number) => {
      if (w <= 1 || h <= 1) return;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';

      // depth range of the particle field this frame, for colour/size mapping
      const proj = particles.map((p) => project(p, ry, rx));

      // constellation lines between nearby particles (drawn first, faintest)
      const link = Math.min(w, h) * 0.17;
      ctx.lineWidth = 1;
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i];
        for (let j = i + 1; j < proj.length; j++) {
          const b = proj[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > link) continue;
          const depth = clamp01(((a.scale + b.scale) / 2 - 0.6) / 0.9);
          const fade = Math.min(edgeFade(a.y), edgeFade(b.y));
          const alpha = (1 - dist / link) * 0.16 * depth * fade * intensity;
          if (alpha < 0.012) continue;
          const c = mixRGB(emerald, volt, depth);
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // orbit rings — each built in its own tilted plane, spun about its normal,
      // then run through the same global projection so it tumbles in 3D.
      for (const ring of ringDefs) {
        const col = ring.kind === 'volt' ? volt : emerald;
        const phase = t * ring.spin;
        const pts = new Array(ring.seg + 1);
        for (let k = 0; k <= ring.seg; k++) {
          const ang = (k / ring.seg) * Math.PI * 2 + phase;
          const local: P3 = { x: Math.cos(ang) * ring.r, y: Math.sin(ang) * ring.r, z: 0 };
          const world = rotZ(rotX(local, ring.tiltX), ring.tiltZ);
          pts[k] = project(world, ry, rx);
        }
        for (let k = 0; k < ring.seg; k++) {
          const a = pts[k], b = pts[k + 1];
          const depth = clamp01(((a.scale + b.scale) / 2 - 0.55) / 1.0);
          const fade = Math.min(edgeFade(a.y), edgeFade(b.y));
          const base = ring.alpha * (0.25 + depth * 0.85) * fade * intensity;
          if (base < 0.01) continue;
          const lw = (0.6 + depth * 1.9) * ((a.scale + b.scale) / 2);
          // soft halo, then crisp core
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${base * 0.28})`;
          ctx.lineWidth = lw * 3.2;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${base})`;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // particles last, on top — near ones bigger, brighter and shifted to volt
      for (const p of proj) {
        const depth = clamp01((p.scale - 0.6) / 0.95);
        const fade = edgeFade(p.y);
        const alpha = (0.18 + depth * 0.6) * fade * intensity;
        if (alpha < 0.02) continue;
        const c = mixRGB(emerald, volt, depth * depth);
        const radius = (0.6 + depth * 2.2) * p.scale;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // ── pointer parallax ──────────────────────────────────────────────────────
    let targetX = 0, targetY = 0;
    const onPointer = (e: PointerEvent) => {
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = (e.clientY / window.innerHeight) * 2 - 1;
    };

    // ── run loop ───────────────────────────────────────────────────────────
    let raf = 0;
    let last = 0;
    let spinY = 0;
    let inView = true;
    let tabVisible = !document.hidden;

    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      spinY += dt * 0.14; // gentle perpetual rotation
      parX += (targetX - parX) * 0.04;
      parY += (targetY - parY) * 0.04;
      const ry = spinY + parX * 0.45;
      const rx = -0.34 + Math.sin(now * 0.00018) * 0.16 + parY * 0.3;
      renderFrame(ry, rx, now / 1000);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (reduceMotion || raf || !inView || !tabVisible) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    // ── wiring ───────────────────────────────────────────────────────────────
    resize();
    buildParticles();

    const ro = new ResizeObserver(() => {
      resize();
      buildParticles();
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVis = () => {
      tabVisible = !document.hidden;
      if (tabVisible) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVis);

    if (reduceMotion) {
      renderFrame(0.6, -0.34, 0); // single composed frame, no animation
    } else {
      window.addEventListener('pointermove', onPointer, { passive: true });
      start();
    }

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      themeObs.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
