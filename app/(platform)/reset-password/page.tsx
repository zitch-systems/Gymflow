import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { LogoMark } from '@/components/ui/logo';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';
import { Star, ShieldCheck, ShieldAlert, ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'Set a new password',
  description: 'Choose a new password for your GymFlow account.',
};

// The /auth/callback handler exchanges the recovery code for a session before
// redirecting here, so a valid link means getUser() returns the user. No session
// → the link was already used, expired, or tampered with.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
          <p>&ldquo;Bank-grade security I never have to think about. My members&rsquo; data and my revenue are safe.&rdquo;</p>
          <div className="by">
            <span className="gf-avatar gf-avatar-md">T</span>
            <span><strong>Tunde Adeyemi</strong><small>Powerhouse Fitness, Lagos</small></span>
          </div>
          <dl className="bs-stats">
            <div><dt>Encryption</dt><dd>AES-256</dd></div>
            <div><dt>Backups</dt><dd>Daily</dd></div>
            <div><dt>Uptime</dt><dd>99.9%</dd></div>
          </dl>
        </div>
      </aside>

      <main className="formside">
        <div className="formcard">
          {user ? (
            <>
              <span className="lock-badge"><ShieldCheck strokeWidth={1.9} /></span>
              <h1>Set a new password</h1>
              <p className="lede">Choose a strong password you don&rsquo;t use anywhere else.</p>
              <ResetPasswordForm />
            </>
          ) : (
            <>
              <span className="lock-badge"><ShieldAlert strokeWidth={1.9} /></span>
              <h1>Link expired</h1>
              <p className="lede">This reset link is invalid or has already been used. Request a fresh one and try again.</p>
              <Link href="/forgot-password" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ marginTop: 8 }}>
                Request a new link
              </Link>
            </>
          )}
          <Link href="/login" className="back-link"><ArrowLeft /> Back to sign in</Link>
        </div>
      </main>

      <ThemeToggleButton />
    </div>
  );
}
