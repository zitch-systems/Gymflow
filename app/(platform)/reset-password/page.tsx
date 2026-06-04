import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { LogoMark } from '@/components/ui/logo';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';

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
    <div className="mk-auth">
      <div className="container mk-auth-narrow">
        <Link href="/" className="gf-logo"><LogoMark /><span className="gf-logo-text">Gym<em>Flow</em></span></Link>
        {user ? (
          <>
            <h2 className="mk-auth-panel-title" style={{ textAlign: 'center', marginTop: 18 }}>Set a new password</h2>
            <p className="mk-auth-panel-sub" style={{ textAlign: 'center' }}>
              Choose a strong password you don’t use anywhere else.
            </p>
            <div style={{ marginTop: 18 }}><ResetPasswordForm /></div>
          </>
        ) : (
          <>
            <h2 className="mk-auth-panel-title" style={{ textAlign: 'center', marginTop: 18 }}>Link expired</h2>
            <p className="mk-auth-panel-sub" style={{ textAlign: 'center' }}>
              This reset link is invalid or has already been used. Request a fresh one and try again.
            </p>
            <div style={{ marginTop: 18 }}>
              <Link href="/forgot-password" className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg">Request a new link</Link>
            </div>
          </>
        )}
        <p className="login-footer" style={{ marginTop: 16, textAlign: 'center' }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
      <ThemeToggleButton />
    </div>
  );
}
