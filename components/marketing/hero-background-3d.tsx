'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Hero 3D background — deliberately understated. A sparse particle constellation
// drifting in real 3D (perspective projection) with faint links between near
// points. No grid / rings / polyhedra: just a calm sense of depth behind the
// copy. Plain 2D canvas, zero deps.
//
// Good-citizen behaviour: caps DPR, pauses when the tab is hidden or the hero
// scrolls out of view, re-reads brand tokens on theme switch, and renders a
// single static frame (no loop) when the user prefers reduced motion.
// ───────────────────────────────────────────────────────────────────────────

type P3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

const FOV = 3.1; // larger = gentler perspective (calmer)

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function parseRGB(v: string): RGB | null {
  const m = v.split(',').map((s) => Number(s.trim()));
  return m.length === 3 && m.every((n) => Number.isFinite(n)) ? (m as RGB) : null;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

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

const rotX = (p: P3, a: number): P3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
};
const rotY = (p: P3, a: number): P3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
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
    let intensity = 1; // dial back on the light theme
    const readTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      emerald = parseRGB(cs.getPropertyValue('--gf-brand-rgb')) ?? emerald;
      volt = parseRGB(cs.getPropertyValue('--gf-accent-rgb')) ?? volt;
      intensity = document.documentElement.getAttribute('data-theme') === 'light' ? 0.5 : 0.85;
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
      if (reduceMotion) renderFrame(0.5, -0.25);
    };

    // ── geometry: a sparse point cloud ──────────────────────────────────────
    let particles: P3[] = [];
    const buildParticles = () => {
      const n = Math.round(Math.min(95, Math.max(36, (w * h) / 15000)));
      particles = Array.from({ length: n }, () => randInSphere(1.2));
    };

    let parX = 0, parY = 0; // eased pointer offset, -1..1
    const project = (p: P3, ry: number, rx: number) => {
      const a = rotX(rotY(p, ry), rx);
      const scale = FOV / (FOV + a.z);
      const R = Math.min(w, h) * 0.42;
      return {
        x: w / 2 + a.x * R * scale + parX * 16,
        y: h / 2 * 0.97 + a.y * R * scale + parY * 12,
        scale,
      };
    };

    const edgeFade = (y: number) =>
      Math.min(clamp01(y / (h * 0.18)), clamp01((h - y) / (h * 0.3)));

    const renderFrame = (ry: number, rx: number) => {
      if (w <= 1 || h <= 1) return;
      ctx.clearRect(0, 0, w, h);

      const proj = particles.map((p) => project(p, ry, rx));

      // faint links between near points
      const link = Math.min(w, h) * 0.12;
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
          const alpha = (1 - dist / link) * 0.09 * depth * fade * intensity;
          if (alpha < 0.012) continue;
          ctx.strokeStyle = `rgba(${emerald[0]},${emerald[1]},${emerald[2]},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // dots — small, soft, mostly emerald with a touch of volt on the nearest
      for (const p of proj) {
        const depth = clamp01((p.scale - 0.6) / 0.95);
        const fade = edgeFade(p.y);
        const alpha = (0.12 + depth * 0.4) * fade * intensity;
        if (alpha < 0.02) continue;
        const c = mixRGB(emerald, volt, depth * depth * 0.6);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (0.5 + depth * 1.5) * p.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    // ── pointer parallax (gentle) ────────────────────────────────────────────
    let targetX = 0, targetY = 0;
    const onPointer = (e: PointerEvent) => {
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = (e.clientY / window.innerHeight) * 2 - 1;
    };

    // ── run loop ─────────────────────────────────────────────────────────────
    let raf = 0;
    let last = 0;
    let spinY = 0;
    let inView = true;
    let tabVisible = !document.hidden;

    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      spinY += dt * 0.05; // slow drift
      parX += (targetX - parX) * 0.03;
      parY += (targetY - parY) * 0.03;
      const ry = spinY + parX * 0.25;
      const rx = -0.25 + Math.sin(now * 0.0001) * 0.08 + parY * 0.18;
      renderFrame(ry, rx);
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
      renderFrame(0.5, -0.25);
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
