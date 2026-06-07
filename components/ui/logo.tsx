import type { ReactNode } from 'react';

export function Logo({ size = 'md', children }: { size?: 'sm' | 'md' | 'lg'; children?: ReactNode }) {
  const cls = size === 'sm' ? 'gf-logo gf-logo-sm' : size === 'lg' ? 'gf-logo gf-logo-lg' : 'gf-logo';
  return (
    <span className={cls}>
      <LogoMark />
      {children ?? (
        <span className="gf-logo-text">
          Gym<em>Flow</em>
        </span>
      )}
    </span>
  );
}

export function LogoMark() {
  return (
    <span className="gf-logo-mark" aria-hidden>
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
      </svg>
    </span>
  );
}
