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
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
        <rect x="2" y="8" width="5" height="8" rx="1.5" fill="currentColor" />
        <rect x="1" y="10.5" width="7" height="3" rx="1" fill="currentColor" />
        <rect x="17" y="8" width="5" height="8" rx="1.5" fill="currentColor" />
        <rect x="16" y="10.5" width="7" height="3" rx="1" fill="currentColor" />
        <rect x="10.5" y="5" width="3" height="14" rx="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}
