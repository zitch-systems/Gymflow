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
        </div>
        <div className="mk-footer-col">
          <h4>Product</h4>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">Gallery</Link>
        </div>
        <div className="mk-footer-col">
          <h4>Account</h4>
          <Link href="/signup">Launch your gym</Link>
          <Link href="/login">Sign in</Link>
        </div>
        <div className="mk-footer-col">
          <h4>Get in touch</h4>
          <a href="mailto:hello@gymflow.ng">hello@gymflow.ng</a>
          <a href="tel:+2348166938327">0816 693 8327</a>
          <span className="mk-footer-muted">41 Ogudu Road, Lagos</span>
        </div>
      </div>
      <div className="container mk-footer-bottom">
        <span>© {new Date().getFullYear()} GymFlow · Made in Lagos</span>
        <span>Powered by Paystack · Supabase · Vercel</span>
      </div>
    </footer>
  );
}
