import Link from 'next/link';

export function MarketingFooter() {
  return (
    <footer id="contact" className="marketing-footer">
      <div className="container mk-footer-grid">
        <div className="mk-footer-brand">
          <Link href="/" className="marketing-logo">
            <span className="marketing-logo-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
              </svg>
            </span>
            <span>Gym<span className="marketing-logo-em">Flow</span></span>
          </Link>
          <p className="mk-footer-tag">Modern gym management for Nigerian fitness businesses.</p>
          <p className="mk-footer-tag mk-footer-muted">41 Ogudu Road, Lagos · hello@gymflow.ng</p>
        </div>
        <div className="mk-footer-col">
          <h4>Product</h4>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/signup">Get started</Link>
          <Link href="/login">Sign in</Link>
        </div>
        <div className="mk-footer-col">
          <h4>Company</h4>
          <Link href="/about">About</Link>
          <Link href="/gallery">Gallery</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/careers">Careers</Link>
        </div>
        <div className="mk-footer-col">
          <h4>Legal</h4>
          <Link href="/legal#privacy">Privacy</Link>
          <Link href="/legal#terms">Terms</Link>
          <Link href="/legal#waiver">Waiver</Link>
          <Link href="/legal#security">Security</Link>
        </div>
      </div>
      <div className="container mk-footer-bottom">
        <span>© {new Date().getFullYear()} GymFlow · Made in Lagos</span>
        <span>Powered by Paystack · Supabase · Vercel</span>
      </div>
    </footer>
  );
}
