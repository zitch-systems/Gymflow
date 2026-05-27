import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';

export function MarketingNav() {
  return (
    <nav className="marketing-nav">
      <div className="container marketing-nav-inner">
        <Link href="/" className="marketing-logo">
          <span className="marketing-logo-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
            </svg>
          </span>
          <span>Gym<span className="marketing-logo-em">Flow</span></span>
        </Link>
        <div className="marketing-nav-links">
          <Link href="/features" className="marketing-nav-link">Features</Link>
          <Link href="/pricing" className="marketing-nav-link">Pricing</Link>
          <Link href="/about" className="marketing-nav-link">Gallery</Link>
          <Link href="/login" className="marketing-nav-link">Sign in</Link>
          <Link href="/signup" className="gf-btn gf-btn-primary">Get started</Link>
          <ThemeToggleButton />
        </div>
      </div>
    </nav>
  );
}
