import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { LogoMark } from '@/components/ui/logo';
import { GymSignupForm } from './gym-signup-form';
import { Star } from 'lucide-react';

export const metadata = {
  title: 'Open your GymFlow account',
  description: 'Self-onboard your gym onto GymFlow. From ₦14,999/month, cancel anytime.',
};

export default function GymSignupPage() {
  return (
    <div className="gf-auth">
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

      <main className="formside">
        <div className="formcard">
          <Link href="/" className="auth-brand gf-logo gf-logo-sm">
            <LogoMark />
            <span className="gf-logo-text">Gym<em>Flow</em></span>
          </Link>
          <h1>Launch your gym</h1>
          <p className="lede">Create your gym in one step — a branded subdomain, admin portal and member app, live in minutes.</p>

          <div className="auth-tabs">
            <Link href="/login">Sign in</Link>
            <a className="on" aria-current="page">Create gym</a>
          </div>

          <GymSignupForm />

          <p className="foot-note">
            Already onboarded? <Link href="/login">Sign in to your gym</Link>
          </p>
        </div>
      </main>

      <ThemeToggleButton />
    </div>
  );
}
