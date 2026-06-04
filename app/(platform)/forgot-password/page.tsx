import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { LogoMark } from '@/components/ui/logo';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = {
  title: 'Forgot your password?',
  description: 'Reset your GymFlow password.',
};

export default function ForgotPasswordPage() {
  return (
    <div className="mk-auth">
      <div className="container mk-auth-narrow">
        <Link href="/" className="gf-logo"><LogoMark /><span className="gf-logo-text">Gym<em>Flow</em></span></Link>
        <h2 className="mk-auth-panel-title" style={{ textAlign: 'center', marginTop: 18 }}>Forgot your password?</h2>
        <p className="mk-auth-panel-sub" style={{ textAlign: 'center' }}>
          Enter the email you sign in with and we’ll send you a link to reset it.
        </p>
        <div style={{ marginTop: 18 }}><ForgotPasswordForm /></div>
        <p className="login-footer" style={{ marginTop: 16, textAlign: 'center' }}>
          Remember it? <Link href="/login">Back to sign in</Link>
        </p>
      </div>
      <ThemeToggleButton />
    </div>
  );
}
