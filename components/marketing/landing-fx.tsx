'use client';

import { useEffect, useRef, type ReactNode } from 'react';

const reduced = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tilt — pointer-driven 3D tilt + lift. The element IS the card (it carries the
// card className), so the whole card rotates toward the cursor in perspective.
export function Tilt({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || reduced()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${px * max}deg) rotateX(${-py * max}deg) translateY(-4px)`;
  }
  function leave() {
    const el = ref.current;
    if (el) el.style.transform = '';
  }

  return (
    <div ref={ref} className={className} style={{ transition: 'transform 0.3s cubic-bezier(.2,.7,.2,1), box-shadow 0.3s ease', transformStyle: 'preserve-3d', willChange: 'transform' }} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </div>
  );
}

// Reveal — fades + slides its children up the first time they scroll into view.
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) { el.classList.add('gl-in'); return; }
    const io = new IntersectionObserver(([e], obs) => {
      if (e.isIntersecting) { el.classList.add('gl-in'); obs.disconnect(); }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`gl-reveal${className ? ` ${className}` : ''}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
