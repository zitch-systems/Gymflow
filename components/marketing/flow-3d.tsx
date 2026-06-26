'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Flow3D — a glowing emerald torus-knot that turns slowly in real perspective,
// drawn on a <canvas> (no three.js). A brand-forward hero visual: one endless
// ribbon weaving over and under itself, depth-shaded so near strands read
// brighter and wider than far ones, wrapped in a soft emerald halo. Leans into
// the "GymFlow" name — motion, not equipment. Deliberately calm: slow spin,
// pauses off-screen / on hidden tabs, renders one static frame under
// prefers-reduced-motion.
// ───────────────────────────────────────────────────────────────────────────

type P3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

const FOV = 4.2;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function parseRGB(v: string): RGB | null {
  const m = v.split(',').map((s) => Number(s.trim()));
  return m.length === 3 && m.every((n) => Number.isFinite(n)) ? (m as RGB) : null;
}

const rotX = (p: P3, a: number): P3 => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; };
const rotY = (p: P3, a: number): P3 => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; };

// A (p,q) torus knot sampled as a closed loop in local space. p=2,q=3 → a
// trefoil-style weave that always reads as one continuous flowing ribbon.
const KP = 2, KQ = 3, SEG = 260;
const KNOT: P3[] = Array.from({ length: SEG }, (_, i) => {
  const t = (i / SEG) * Math.PI * 2;
  const r = Math.cos(KQ * t) + 2.2;
  return { x: (r * Math.cos(KP * t)) / 3.2, y: (r * Math.sin(KP * t)) / 3.2, z: -Math.sin(KQ * t) / 3.2 };
});

export function Flow3D() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let brand: RGB = [17, 209, 139];
    const readTheme = () => {
      brand = parseRGB(getComputedStyle(document.documentElement).getPropertyValue('--gf-brand-rgb')) ?? brand;
    };
    readTheme();
    const themeObs = new MutationObserver(readTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    let w = 0, h = 0, S = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      S = Math.min(w, h) * 0.34; // world→screen scale
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduceMotion) frame(0.9);
    };

    const project = (p: P3) => {
      const scale = FOV / (FOV + p.z);
      return { x: w / 2 + p.x * S * scale, y: h / 2 + p.y * S * scale, scale };
    };

    const frame = (ry: number) => {
      if (w <= 1) return;
      ctx.clearRect(0, 0, w, h);

      // soft emerald centre glow
      const gg = ctx.createRadialGradient(w / 2, h * 0.5, 2, w / 2, h * 0.5, Math.min(w, h) * 0.62);
      gg.addColorStop(0, `rgba(${brand[0]},${brand[1]},${brand[2]},0.13)`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, w, h);

      // fixed diagonal tilt; ry animates the continuous spin
      const tx = 0.62;
      const pts = KNOT.map((p) => project(rotX(rotY(p, ry), tx)));
      const rot = KNOT.map((p) => rotX(rotY(p, ry), tx));

      // halo — the whole ribbon as one translucent wide stroke (cheap glow)
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(${brand[0]},${brand[1]},${brand[2]},0.10)`;
      ctx.lineWidth = S * 0.16;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();

      // depth-sorted segments, far → near, so the ribbon weaves believably
      const segs = pts.map((_, i) => {
        const j = (i + 1) % pts.length;
        return { i, j, z: (rot[i].z + rot[j].z) / 2, scale: (pts[i].scale + pts[j].scale) / 2 };
      }).sort((a, b) => b.z - a.z);

      for (const sg of segs) {
        const a = pts[sg.i], b = pts[sg.j];
        const d = clamp01((sg.scale - 0.74) / 0.5); // 0 far → 1 near
        const lit = 0.4 + 0.6 * d;
        const hl = 0.45 * d * d; // subtle white sheen on the nearest strands
        const cr = Math.min(255, brand[0] * lit + 255 * hl) | 0;
        const cg = Math.min(255, brand[1] * lit + 255 * hl) | 0;
        const cb = Math.min(255, brand[2] * lit + 255 * hl) | 0;
        ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
        ctx.lineWidth = Math.max(1, S * 0.052 * sg.scale);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    };

    let raf = 0, last = 0, t = 0, inView = true, tabVisible = !document.hidden;
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      frame(t * 0.5); // slow continuous spin
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (reduceMotion || raf || !inView || !tabVisible) return; last = 0; raf = requestAnimationFrame(loop); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) start(); else stop(); }, { threshold: 0 });
    io.observe(canvas);
    const onVis = () => { tabVisible = !document.hidden; if (tabVisible) start(); else stop(); };
    document.addEventListener('visibilitychange', onVis);

    if (reduceMotion) frame(0.9); else start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      themeObs.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="flow3d" aria-hidden="true" />;
}
