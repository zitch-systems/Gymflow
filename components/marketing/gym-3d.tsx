'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Gym3D — a single, slowly-rotating 3D dumbbell drawn on a <canvas> with real
// perspective projection (no three.js). A contained, on-theme hero visual: two
// shaded metal weights + a metallic handle, with an emerald rim-light tying it
// to the brand. Deliberately calm — slow swing, pauses off-screen, static frame
// under prefers-reduced-motion.
// ───────────────────────────────────────────────────────────────────────────

type P3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

const FOV = 3.6;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function parseRGB(v: string): RGB | null {
  const m = v.split(',').map((s) => Number(s.trim()));
  return m.length === 3 && m.every((n) => Number.isFinite(n)) ? (m as RGB) : null;
}

const rotX = (p: P3, a: number): P3 => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; };
const rotY = (p: P3, a: number): P3 => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; };
const rotZ = (p: P3, a: number): P3 => { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z }; };

// Dumbbell geometry along the X axis (local space). Weights spaced wide enough
// that the handle stays visible at every angle of the swing.
const WEIGHT = 0.74; // distance of each weight centre from middle
const RW = 0.4;      // weight (sphere) radius
const RH = 0.095;    // handle radius

export function Gym3D() {
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
      S = Math.min(w, h * 1.7) * 0.3; // world→screen scale (dumbbell is wide)
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduceMotion) frame(0.7);
    };

    const project = (p: P3) => {
      const scale = FOV / (FOV + p.z);
      return { x: w / 2 + p.x * S * scale, y: h * 0.52 + p.y * S * scale, scale };
    };

    const drawSphere = (cx: number, cy: number, r: number, depth: number) => {
      const lit = 0.65 + 0.35 * depth; // nearer weight reads brighter
      const g = ctx.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.08, cx, cy, r);
      g.addColorStop(0, `rgb(${(74 * lit) | 0},${(82 * lit) | 0},${(95 * lit) | 0})`);
      g.addColorStop(0.5, '#222831');
      g.addColorStop(1, '#080a0d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      // emerald rim light along the lower-right
      ctx.strokeStyle = `rgba(${brand[0]},${brand[1]},${brand[2]},${0.55 * depth})`;
      ctx.lineWidth = Math.max(1, r * 0.07);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.95, Math.PI * 0.05, Math.PI * 0.8); ctx.stroke();
      // specular highlight
      ctx.fillStyle = `rgba(255,255,255,${0.32 * lit})`;
      ctx.beginPath(); ctx.arc(cx - r * 0.34, cy - r * 0.4, r * 0.15, 0, Math.PI * 2); ctx.fill();
    };

    const frame = (ry: number) => {
      if (w <= 1) return;
      ctx.clearRect(0, 0, w, h);

      const tz = -0.35, tx = 0.16; // fixed diagonal tilt; ry animates the swing
      const tf = (p: P3) => rotX(rotY(rotZ(p, tz), ry), tx);
      const L = tf({ x: -WEIGHT, y: 0, z: 0 });
      const R = tf({ x: WEIGHT, y: 0, z: 0 });
      const pL = project(L), pR = project(R);

      // soft emerald ground glow
      const gg = ctx.createRadialGradient(w / 2, h * 0.74, 2, w / 2, h * 0.74, Math.min(w, h) * 0.6);
      gg.addColorStop(0, `rgba(${brand[0]},${brand[1]},${brand[2]},0.10)`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, w, h);

      // handle (metallic capsule between the weights), drawn behind the weights
      const hw = RH * S * ((pL.scale + pR.scale) / 2);
      const hg = ctx.createLinearGradient(pL.x, pL.y, pR.x, pR.y);
      hg.addColorStop(0, '#373d46'); hg.addColorStop(0.5, '#b3bcc6'); hg.addColorStop(1, '#373d46');
      ctx.strokeStyle = hg;
      ctx.lineWidth = hw * 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pL.x, pL.y); ctx.lineTo(pR.x, pR.y); ctx.stroke();

      // weights, far → near (painter's order)
      const items = [
        { p: pL, r: RW * S * pL.scale, d: clamp01((pL.scale - 0.7) / 0.6), z: L.z },
        { p: pR, r: RW * S * pR.scale, d: clamp01((pR.scale - 0.7) / 0.6), z: R.z },
      ].sort((a, b) => b.z - a.z);
      for (const it of items) drawSphere(it.p.x, it.p.y, it.r, it.d);
    };

    let raf = 0, last = 0, t = 0, inView = true, tabVisible = !document.hidden;
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      frame(Math.sin(t * 0.55) * 0.7); // gentle ±40° swing — always reads as a dumbbell
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

    if (reduceMotion) frame(0.7); else start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      themeObs.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="gym3d" aria-hidden="true" />;
}
