import Link from 'next/link';
import { preload } from 'react-dom';
import { ThemeToggleButton } from '@/lib/theme';
import { getGymBySlug } from '@/lib/auth/gym';
import { LogoMark } from '@/components/ui/logo';
import { LoginForm } from './login-form';
import { Star, User, LayoutDashboard, GraduationCap, ShieldCheck } from 'lucide-react';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ welcome?: string; redirect?: string; reset?: string; suspended?: string; updated?: string }>;
};

// "or jump in as" — the four product surfaces, mirroring the design system. They
// route to each area's root; auth still gates entry past the login.
const ROLES = [
  { href: '/dashboard', label: 'Member', icon: User },
  { href: '/admin', label: 'Gym owner', icon: LayoutDashboard },
  { href: '/coach', label: 'Instructor', icon: GraduationCap },
  { href: '/superadmin', label: 'Platform', icon: ShieldCheck },
];

export default async function LoginPage({ params, searchParams }: PageProps) {
  // Brand-panel backdrop is a CSS background-image — preload so it arrives before
  // CSS parsing on members landing from email links.
  preload('/images/gym-studio.jpg', { as: 'image', fetchPriority: 'high' });

  const { slug } = await params;
  const sp = await searchParams;
  const gym = await getGymBySlug(slug);

  return (
    <div className="gf-auth">
      {/* Brand panel (left) — social proof, hidden on mobile */}
      <aside className="brandside">
        <div className="brandside-bg" aria-hidden />
        <Link href="/" className="auth-brand gf-logo">
          <LogoMark />
          <span className="gf-logo-text">Gym<em>Flow</em></span>
        </Link>
        <div className="bs-quote">
          <div className="stars" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={18} strokeWidth={1.75} />
            ))}
          </div>
          <p>&ldquo;Setup took an afternoon. Members add it to their home screen and it feels like our own app.&rdquo;</p>
          <div className="by">
            <span className="gf-avatar gf-avatar-md">K</span>
            <span><strong>Kelechi Obi</strong><small>IronWorks Gym, Port Harcourt</small></span>
          </div>
          <dl className="bs-stats">
            <div><dt>Active gyms</dt><dd>1,200+</dd></div>
            <div><dt>Check-ins / mo</dt><dd>480K</dd></div>
            <div><dt>Uptime</dt><dd>99.9%</dd></div>
          </dl>
        </div>
      </aside>

      {/* Form panel (right) */}
      <main className="formside">
        <div className="formcard">
          <Link href="/" className="auth-brand gf-logo gf-logo-sm">
            <LogoMark />
            <span className="gf-logo-text">Gym<em>Flow</em></span>
          </Link>
          <h1>Welcome back</h1>
          <p className="lede">{gym ? `Sign in to ${gym.name}.` : "Sign in to your gym's dashboard."}</p>

          <div className="auth-tabs">
            <a className="on" aria-current="page">Sign in</a>
            <Link href="/signup">Create gym</Link>
          </div>

          {sp.welcome === '1' && (
            <div className="success-msg show" style={{ margin: '0 0 16px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Account created! Sign in to continue.
            </div>
          )}
          {sp.reset === '1' && (
            <div className="success-msg show" style={{ margin: '0 0 16px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Reset link sent — check your email.
            </div>
          )}
          {sp.updated === '1' && (
            <div className="success-msg show" style={{ margin: '0 0 16px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Password updated — sign in with your new password.
            </div>
          )}
          {sp.suspended === '1' && (
            <div className="error-msg show" style={{ margin: '0 0 16px' }}>
              This gym is currently unavailable. Please contact your gym owner or
              {' '}<a className="gf-link" href="mailto:hello@gymflow.ng">hello@gymflow.ng</a> for help.
            </div>
          )}

          <LoginForm redirectTo={sp.redirect ?? ''} slug={slug} />

          <div className="auth-divider">or jump in as</div>
          <div className="auth-roles">
            {ROLES.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="role-btn">
                <Icon strokeWidth={1.75} /> {label}
              </Link>
            ))}
          </div>

          <p className="foot-note">
            New member? <Link href="/join">Create your account</Link>
          </p>
        </div>
      </main>

      <ThemeToggleButton />
    </div>
  );
}
