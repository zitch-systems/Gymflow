import Link from 'next/link';
import { preload } from 'react-dom';
import { ThemeToggleButton } from '@/lib/theme';
import { getGymBySlug } from '@/lib/auth/gym';
import { LogoMark } from '@/components/ui/logo';
import { LoginForm } from './login-form';
import { ScanLine, CalendarDays, CreditCard } from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ welcome?: string; redirect?: string; reset?: string; suspended?: string; updated?: string }>;
};

const MEMBER_POINTS = [
  { icon: ScanLine, label: 'Check in with a tap', sub: 'Scan the gym QR from your phone' },
  { icon: CalendarDays, label: 'Book your classes', sub: 'See the timetable and reserve a spot' },
  { icon: CreditCard, label: 'Renew in seconds', sub: 'Pay or auto-renew via Paystack' },
];

export default async function LoginPage({ params, searchParams }: PageProps) {
  // Studio backdrop is a CSS background-image — preload so it arrives before
  // CSS parsing on members landing from email links.
  preload('/images/gym-studio.jpg', { as: 'image', fetchPriority: 'high' });

  const { slug } = await params;
  const sp = await searchParams;
  const gym = await getGymBySlug(slug);
  const gymName = gym?.name ?? 'Welcome back';

  return (
    <div className="mk-auth">
      <div className="container mk-auth-split mk-auth-login">
        {/* Brand / value panel — gym-branded, photo backdrop */}
        <aside className="mk-auth-aside mk-login-aside">
          <div className="mk-login-aside-bg" style={{ backgroundImage: 'url(/images/gym-studio.jpg)' }} aria-hidden />
          <div className="mk-login-aside-inner">
            <Link href="/" className="gf-logo"><LogoMark /><span className="gf-logo-text">Gym<em>Flow</em></span></Link>
            <div className="mk-login-aside-body">
              <div className="gym-avatar mk-login-gymavatar">
                {gym?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={gym.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                ) : (
                  (gym?.name?.charAt(0) ?? 'G').toUpperCase()
                )}
              </div>
              <h1 className="mk-login-gymname">{gymName}</h1>
              <p className="mk-login-tagline">Your membership, in your pocket.</p>
              <ul className="mk-login-points">
                {MEMBER_POINTS.map(({ icon: Icon, label, sub }) => (
                  <li key={label}>
                    <span className="mk-login-point-icon" aria-hidden><Icon size={16} strokeWidth={1.75} /></span>
                    <span><span className="mk-login-point-label">{label}</span><span className="mk-login-point-sub">{sub}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* Form panel */}
        <div className="mk-auth-panel mk-login-panel">
          <div className="mk-login-mobilehead">
            <span className="gym-avatar gym-avatar-sm">
              {gym?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gym.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
              ) : (
                (gym?.name?.charAt(0) ?? 'G').toUpperCase()
              )}
            </span>
            <span className="mk-login-mobilename">{gymName}</span>
          </div>

          <h2 className="mk-auth-panel-title">Sign in</h2>
          <p className="mk-auth-panel-sub">Welcome back — access your membership portal.</p>

          {sp.welcome === '1' && (
            <div className="success-msg show" style={{ margin: '14px 0 0' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Account created! Sign in to continue.
            </div>
          )}
          {sp.reset === '1' && (
            <div className="success-msg show" style={{ margin: '14px 0 0' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Reset link sent — check your email.
            </div>
          )}
          {sp.updated === '1' && (
            <div className="success-msg show" style={{ margin: '14px 0 0' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Password updated — sign in with your new password.
            </div>
          )}
          {sp.suspended === '1' && (
            <div className="error-msg show" style={{ margin: '14px 0 0' }}>
              This gym is currently unavailable. Please contact your gym owner or
              {' '}<a className="gf-link" href="mailto:hello@gymflow.ng">hello@gymflow.ng</a> for help.
            </div>
          )}

          <div className="login-card" style={{ marginTop: 16 }}>
            <LoginForm redirectTo={sp.redirect ?? ''} slug={slug} />
          </div>

          <p className="login-footer" style={{ marginTop: 16 }}>
            New member? <Link href="/join">Create account</Link>
          </p>
        </div>
      </div>
      <ThemeToggleButton />
    </div>
  );
}
