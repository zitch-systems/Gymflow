'use client';

import { useEffect, useRef } from 'react';

// ───────────────────────────────────────────────────────────────────────────
// Hero 3D background — a real 3D scene drawn on a <canvas> with the plain 2D
// API and hand-rolled perspective projection. No three.js / WebGL: the whole
// thing is a few hundred bytes of math, which keeps the marketing bundle lean
// (on-brand: "light enough to fly on Nigerian networks").
//
// What you see, layered back-to-front:
//   • a receding perspective wave-grid "floor" that undulates,
//   • a depth-faded particle constellation,
//   • three tumbling orbit rings (the "flow"),
//   • a few wireframe polyhedra (octahedra + an icosahedron) spinning on their
//     own axes while the whole scene tumbles and parallax-tilts to the pointer.
// All tinted with the GymFlow emerald → volt palette.
//
// Good-citizen behaviour: caps DPR, pauses when the tab is hidden or the hero
// scrolls out of view, re-reads brand tokens on theme switch, and renders a
// single static frame (no loop) when the user prefers reduced motion.
// ───────────────────────────────────────────────────────────────────────────

type P3 = { x: number; y: number; z: number };
type RGB = [number, number, number];
type Edge = [number, number];

type Ring = {
  r: number; // radius
  tiltX: number; // fixed orientation of the ring's plane
  tiltZ: number;
  spin: number; // own spin speed (rad/s) around its normal
  seg: number; // segment count
  kind: 'volt' | 'emerald'; // resolved to the live palette each frame
  alpha: number;
};

type Solid = {
  v: P3[]; // unit vertices
  e: Edge[]; // edges (vertex-index pairs)
  pos: P3; // centre in world space
  scale: number;
  phase: P3; // starting orientation
  spin: P3; // per-axis spin speed (rad/s)
  kind: 'volt' | 'emerald';
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

// Derive a wireframe's edges from its vertices: connect every pair whose
// distance is within a hair of the shortest pair (i.e. the true polyhedron
// edges). Lets us declare just the vertices for any regular solid.
function buildEdges(v: P3[]): Edge[] {
  const d2 = (a: P3, b: P3) => {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  };
  let min = Infinity;
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) min = Math.min(min, d2(v[i], v[j]));
  const eps = min * 1.08;
  const edges: Edge[] = [];
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) if (d2(v[i], v[j]) <= eps) edges.push([i, j]);
  return edges;
}

const norm = (p: P3): P3 => {
  const m = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / m, y: p.y / m, z: p.z / m };
};

// Unit polyhedra (vertices only — edges are derived).
const OCTA_V: P3[] = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
];
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: P3[] = [
  { x: 0, y: 1, z: PHI }, { x: 0, y: 1, z: -PHI }, { x: 0, y: -1, z: PHI }, { x: 0, y: -1, z: -PHI },
  { x: 1, y: PHI, z: 0 }, { x: 1, y: -PHI, z: 0 }, { x: -1, y: PHI, z: 0 }, { x: -1, y: -PHI, z: 0 },
  { x: PHI, y: 0, z: 1 }, { x: PHI, y: 0, z: -1 }, { x: -PHI, y: 0, z: 1 }, { x: -PHI, y: 0, z: -1 },
].map(norm);
const OCTA_E = buildEdges(OCTA_V);
const ICO_E = buildEdges(ICO_V);

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

    const solids: Solid[] = [
      { v: OCTA_V, e: OCTA_E, pos: { x: -1.05, y: -0.55, z: 0.15 }, scale: 0.26, phase: { x: 0.4, y: 1.1, z: 0 }, spin: { x: 0.5, y: 0.42, z: 0.2 }, kind: 'volt', alpha: 0.85 },
      { v: ICO_V, e: ICO_E, pos: { x: 1.08, y: 0.42, z: -0.2 }, scale: 0.32, phase: { x: 1.0, y: 0.2, z: 0.5 }, spin: { x: 0.3, y: -0.36, z: 0.16 }, kind: 'emerald', alpha: 0.7 },
      { v: OCTA_V, e: OCTA_E, pos: { x: 0.25, y: -1.0, z: 0.45 }, scale: 0.2, phase: { x: 0.7, y: 0.5, z: 1.2 }, spin: { x: -0.42, y: 0.32, z: 0.26 }, kind: 'emerald', alpha: 0.6 },
    ];

    let particles: P3[] = [];
    const buildParticles = () => {
      const n = Math.round(Math.min(170, Math.max(60, (w * h) / 8200)));
      particles = Array.from({ length: n }, () => randInSphere(1.25));
    };

    // Receding wave-grid "floor": a plane of points (X across, Z into the scene)
    // whose height ripples over time. Density scales gently with viewport.
    let gridCols = 20, gridRows = 14;
    const buildGrid = () => {
      gridCols = Math.max(12, Math.min(24, Math.round(w / 58)));
      gridRows = Math.max(9, Math.min(16, Math.round(h / 34)));
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

    const seg = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };

    // ── one frame ───────────────────────────────────────────────────────────
    const renderFrame = (ry: number, rx: number, t: number) => {
      if (w <= 1 || h <= 1) return;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';

      // (1) wave-grid floor — its own steep, near-static tilt (parallax only) so
      // it reads as ground rather than tumbling with the rest of the scene.
      const gry = parX * 0.4;
      const grx = 1.02 + parY * 0.18;
      const gw = 3.4, gd = 3.2, gx0 = -gw / 2, gz0 = -1.0;
      const gridPts: { x: number; y: number; scale: number }[][] = [];
      for (let r = 0; r <= gridRows; r++) {
        const row: { x: number; y: number; scale: number }[] = [];
        const zz = gz0 + (r / gridRows) * gd;
        for (let c = 0; c <= gridCols; c++) {
          const xx = gx0 + (c / gridCols) * gw;
          const yy = 0.82 + Math.sin(xx * 1.6 + t * 0.9) * 0.1 + Math.sin(zz * 1.3 - t * 0.7) * 0.1;
          row.push(project({ x: xx, y: yy, z: zz }, gry, grx));
        }
        gridPts.push(row);
      }
      const gridAlpha = (s: number, y: number) =>
        clamp01((s - 0.55) / 1.0) * 0.16 * edgeFade(y) * intensity;
      ctx.lineWidth = 1;
      for (let r = 0; r <= gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          const a = gridPts[r][c], b = gridPts[r][c + 1];
          const al = gridAlpha((a.scale + b.scale) / 2, (a.y + b.y) / 2);
          if (al < 0.012) continue;
          ctx.strokeStyle = `rgba(${emerald[0]},${emerald[1]},${emerald[2]},${al})`;
          seg(a, b);
        }
      }
      for (let c = 0; c <= gridCols; c++) {
        for (let r = 0; r < gridRows; r++) {
          const a = gridPts[r][c], b = gridPts[r + 1][c];
          const al = gridAlpha((a.scale + b.scale) / 2, (a.y + b.y) / 2) * 0.8;
          if (al < 0.012) continue;
          ctx.strokeStyle = `rgba(${emerald[0]},${emerald[1]},${emerald[2]},${al})`;
          seg(a, b);
        }
      }

      // depth range of the particle field this frame, for colour/size mapping
      const proj = particles.map((p) => project(p, ry, rx));

      // (2) constellation lines between nearby particles
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
          seg(a, b);
        }
      }

      // (3) orbit rings — each built in its own tilted plane, spun about its
      // normal, then run through the same global projection so it tumbles in 3D.
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
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${base * 0.28})`; // halo
          ctx.lineWidth = lw * 3.2;
          seg(a, b);
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${base})`; // core
          ctx.lineWidth = lw;
          seg(a, b);
        }
      }

      // (4) wireframe polyhedra — spin on their own axes, ride the global tumble
      for (const s of solids) {
        const col = s.kind === 'volt' ? volt : emerald;
        const ax = s.phase.x + t * s.spin.x;
        const ay = s.phase.y + t * s.spin.y;
        const az = s.phase.z + t * s.spin.z;
        const vp = s.v.map((vtx) => {
          const local = rotZ(rotY(rotX(vtx, ax), ay), az);
          const world: P3 = {
            x: local.x * s.scale + s.pos.x,
            y: local.y * s.scale + s.pos.y,
            z: local.z * s.scale + s.pos.z,
          };
          return project(world, ry, rx);
        });
        for (const [ia, ib] of s.e) {
          const a = vp[ia], b = vp[ib];
          const depth = clamp01(((a.scale + b.scale) / 2 - 0.5) / 1.1);
          const fade = Math.min(edgeFade(a.y), edgeFade(b.y));
          const base = s.alpha * (0.3 + depth * 0.8) * fade * intensity;
          if (base < 0.01) continue;
          const lw = (0.5 + depth * 1.4) * ((a.scale + b.scale) / 2);
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${base * 0.3})`; // halo
          ctx.lineWidth = lw * 3;
          seg(a, b);
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${base})`; // core
          ctx.lineWidth = lw;
          seg(a, b);
        }
        for (const q of vp) {
          const depth = clamp01((q.scale - 0.5) / 1.1);
          const fade = edgeFade(q.y);
          const a = s.alpha * (0.4 + depth * 0.6) * fade * intensity;
          if (a < 0.02) continue;
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
          ctx.beginPath();
          ctx.arc(q.x, q.y, (0.8 + depth * 1.8) * q.scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // (5) particles last, on top — near ones bigger, brighter, shifted to volt
      for (const p of proj) {
        const depth = clamp01((p.scale - 0.6) / 0.95);
        const fade = edgeFade(p.y);
        const alpha = (0.18 + depth * 0.6) * fade * intensity;
        if (alpha < 0.02) continue;
        const c = mixRGB(emerald, volt, depth * depth);
        const radius = (0.6 + depth * 2.2) * p.scale;
        // soft halo on the nearest particles for extra depth sparkle
        if (depth > 0.72) {
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha * 0.22})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
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
    buildGrid();

    const ro = new ResizeObserver(() => {
      resize();
      buildParticles();
      buildGrid();
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
