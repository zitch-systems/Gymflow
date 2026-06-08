import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from '@/components/theme-toggle';

// Shared marketing nav + footer, recreated from revamp/marketing.html chrome.
// `cur` highlights the active top-level link.
export function MarketingNav({ cur }: { cur?: 'features' | 'pricing' | 'about' | 'contact' }) {
  return (
    <nav className="nav">
      <Link href="/" className="brand" aria-label="GymFlow home">
        <Image src="/images/logomark-v2.svg" alt="" width={30} height={30} className="mark-sm" priority />
        <span className="brand-tx">Gym<em>Flow</em></span>
      </Link>
      <div className="links">
        <Link href="/features" className={cur === 'features' ? 'cur' : undefined}>Features</Link>
        <Link href="/pricing" className={cur === 'pricing' ? 'cur' : undefined}>Pricing</Link>
        <Link href="/about" className={cur === 'about' ? 'cur' : undefined}>About</Link>
        <Link href="/contact" className={cur === 'contact' ? 'cur' : undefined}>Contact</Link>
        <Link href="/login">Sign in</Link>
        <ThemeToggle size={38} />
        <Link href="/signup" className="gf-btn gf-btn-primary btnlink">Get started</Link>
      </div>
    </nav>
  );
}

export function MarketingFooter() {
  return (
    <footer>
      <div className="wrap foot">
        <div>
          <Link href="/" className="brand">
            <Image src="/images/logomark-v2.svg" alt="" width={30} height={30} className="mark-sm" />
            <span className="brand-tx">Gym<em>Flow</em></span>
          </Link>
          <p>Modern gym management for Nigerian fitness businesses. 41 Ogudu Road, Lagos · hello@gymflow.ng</p>
        </div>
        <div>
          <h4>Product</h4>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/dashboard">Member app</Link>
          <Link href="/admin">For owners</Link>
        </div>
        <div>
          <h4>Company</h4>
          <Link href="/about">About</Link>
          <Link href="/gallery">Gallery</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/careers">Careers</Link>
        </div>
        <div>
          <h4>Legal</h4>
          <Link href="/legal#privacy">Privacy</Link>
          <Link href="/legal#terms">Terms</Link>
          <Link href="/legal#waiver">Waiver</Link>
          <Link href="/legal#security">Security</Link>
        </div>
      </div>
    </footer>
  );
}
