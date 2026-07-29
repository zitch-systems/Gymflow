'use client';

import type { Route } from 'next';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Dumbbell } from 'lucide-react';

export type GymNavSection = { id: string; label: string };

/**
 * Sticky gym bar: identity on the left, jump links in the middle, join on the
 * right.
 *
 * The landing page is a long scroll whose only calls to action were at the very
 * top and the very bottom — a visitor reading the class list had nothing to tap
 * without scrolling to one end. This keeps the decision one tap away the whole
 * way down, which is the single biggest conversion gap on the page.
 *
 * It appears only after the hero has scrolled past: over the hero it would sit
 * on top of the same buttons it duplicates.
 */
export function GymNav({
  gymName, logoUrl, joinHref, signedIn, sections,
}: {
  gymName: string;
  logoUrl: string | null;
  joinHref: Route;
  signedIn: boolean;
  sections: GymNavSection[];
}) {
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const hero = document.querySelector('.gl-hero');
    // The hero always renders on this page; if it somehow doesn't, leave the
    // bar hidden rather than setting state during the effect body.
    if (!hero) return;
    // Show the bar once the hero's bottom edge leaves the viewport.
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting), { rootMargin: '-72px 0px 0px 0px' });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (sections.length === 0) return;
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    // Highlight the section occupying the upper third of the viewport — the
    // band a reader is actually looking at.
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-72px 0px -66% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  return (
    <div className={`gl-nav${shown ? ' on' : ''}`} aria-hidden={!shown}>
      <nav className="gl-nav-in" aria-label={`${gymName} sections`}>
        <span className="gl-nav-id">
          {logoUrl
            ? <Image src={logoUrl} alt="" width={30} height={30} />
            : <span className="gl-nav-mark"><Dumbbell size={16} strokeWidth={1.9} /></span>}
          <b>{gymName}</b>
        </span>

        <ul className="gl-nav-links">
          {sections.map((s) => (
            <li key={s.id}>
              {/* Plain anchors: native smooth scrolling (CSS scroll-behavior)
                  and a working link if JS never runs. */}
              <a href={`#${s.id}`} className={active === s.id ? 'on' : undefined} aria-current={active === s.id ? 'true' : undefined} tabIndex={shown ? 0 : -1}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>

        <Link href={signedIn ? '/launch' : joinHref} className="gf-btn gf-btn-primary gf-btn-sm gl-nav-cta" tabIndex={shown ? 0 : -1}>
          {signedIn ? 'My dashboard' : 'Join'} <ArrowRight strokeWidth={2} style={{ width: 15, height: 15 }} />
        </Link>
      </nav>
    </div>
  );
}
